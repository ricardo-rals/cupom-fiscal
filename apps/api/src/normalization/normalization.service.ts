import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { UnidadePadrao } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface ItemNormalizado {
  id: number;
  produto: string;
  marca: string;
  conteudo: number;
  unidade_padrao: UnidadePadrao;
  categoria: string;
  confianca: number;
}

interface RespostaIa {
  itens: ItemNormalizado[];
  chamada: {
    modelo: string;
    tokens_in: number;
    tokens_out: number;
    custo: string;
    latencia_ms: number;
  };
  prompt_version: string;
}

interface ItemPendente {
  id: number;
  descricao_original: string;
  unidade: string;
}

const TAMANHO_DO_LOTE = 20;
const TIMEOUT_AI_MS = 240_000; // cobre as novas tentativas de um lote
const FINALIDADE = 'normalizacao';

// Nome canônico e marca gravados sem acento e em minúsculas, para a chave única de produto funcionar.
const canonico = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const chaveDeProduto = (produto: {
  produto: string;
  marca: string;
  conteudo: number;
  unidade_padrao: UnidadePadrao;
}) => ({
  nome_canonico: canonico(produto.produto),
  marca: canonico(produto.marca),
  conteudo: produto.conteudo.toFixed(4),
  unidade_padrao: produto.unidade_padrao,
});

/** Vale para todo uso de LLM no mês: normalização e agente somam no mesmo limite. */
export async function limiteDeGastoAtingido(prisma: PrismaService) {
  const limite = Number(process.env.LLM_LIMITE_MENSAL_USD ?? 5);
  const agora = new Date();
  const inicioDoMes = new Date(
    Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1),
  );
  const { _sum } = await prisma.llmCall.aggregate({
    where: { criado_em: { gte: inicioDoMes } },
    _sum: { custo: true },
  });
  return Number(_sum.custo ?? 0) >= limite;
}

@Injectable()
export class NormalizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pode ser chamado de novo: itens já resolvidos são ignorados. */
  async normalizarCupom(receiptId: number) {
    const cupom = await this.prisma.receipt.findUniqueOrThrow({
      where: { id: receiptId },
      include: {
        store: true,
        items: { where: { normalization: { is: null } } },
      },
    });

    const pendentes = await this.resolverSemLlm(cupom.items, cupom.store.cnpj);

    if (pendentes.length > 0) {
      const correcoes = await this.correcoes();
      for (let i = 0; i < pendentes.length; i += TAMANHO_DO_LOTE) {
        const lote = pendentes.slice(i, i + TAMANHO_DO_LOTE);
        await this.normalizarLote(lote, correcoes, cupom.store.cnpj);
      }
    }

    await this.prisma.receipt.update({
      where: { id: receiptId },
      data: { status: 'normalizado' },
    });
  }

  /** Correção do usuário vence o cache, e os dois evitam chamar o LLM. */
  private async resolverSemLlm(itens: ItemPendente[], cnpj: string) {
    const pendentes: ItemPendente[] = [];
    for (const item of itens) {
      const correcao = await this.prisma.userLabel.findFirst({
        where: { descricao_original: item.descricao_original },
        orderBy: { id: 'desc' },
      });
      const cache = correcao
        ? null
        : await this.prisma.normalizationCache.findUnique({
            where: {
              descricao_original_cnpj: {
                descricao_original: item.descricao_original,
                cnpj,
              },
            },
          });
      const productId = correcao?.product_id ?? cache?.product_id;
      if (productId === undefined) {
        pendentes.push(item);
        continue;
      }
      await this.prisma.itemNormalization.create({
        data: {
          receipt_item_id: item.id,
          product_id: productId,
          confianca: 1,
          origem: correcao ? 'usuario' : 'cache',
        },
      });
    }
    return pendentes;
  }

  private async correcoes() {
    const rotulos = await this.prisma.userLabel.findMany({
      include: { product: true, category: true },
    });
    return rotulos.map((r) => ({
      descricao_original: r.descricao_original,
      produto: r.product.nome_canonico,
      marca: r.product.marca,
      conteudo: Number(r.product.conteudo),
      unidade_padrao: r.product.unidade_padrao,
      categoria: r.category.nome,
    }));
  }

  private async normalizarLote(
    lote: ItemPendente[],
    correcoes: unknown[],
    cnpj: string,
  ) {
    if (await limiteDeGastoAtingido(this.prisma))
      return this.enviarParaRevisao(lote);

    const resposta = await this.chamarIa(lote, correcoes);
    if (resposta === 'sem_llm') return this.enviarParaRevisao(lote);

    const limiar = Number(process.env.NORMALIZACAO_LIMIAR ?? 0.8);
    const porId = new Map(resposta.itens.map((item) => [item.id, item]));
    const categorias = new Map(
      (await this.prisma.category.findMany()).map((c) => [c.nome, c.id]),
    );

    await this.prisma.$transaction(async (tx) => {
      const chamada = await tx.llmCall.create({
        data: { finalidade: FINALIDADE, ...resposta.chamada },
      });
      const comum = {
        llm_call_id: chamada.id,
        prompt_version: resposta.prompt_version,
      };

      for (const item of lote) {
        const normalizado = porId.get(item.id);
        const categoryId = normalizado && categorias.get(normalizado.categoria);
        if (!normalizado || categoryId === undefined) {
          await tx.itemNormalization.create({
            data: {
              receipt_item_id: item.id,
              confianca: 0,
              origem: 'llm',
              em_revisao: true,
              ...comum,
            },
          });
          continue;
        }

        const chave = chaveDeProduto(normalizado);
        const produto = await tx.product.upsert({
          where: { nome_canonico_marca_conteudo_unidade_padrao: chave },
          create: { ...chave, category_id: categoryId },
          update: {},
        });
        const confiante = normalizado.confianca >= limiar;
        await tx.itemNormalization.create({
          data: {
            receipt_item_id: item.id,
            product_id: produto.id,
            confianca: normalizado.confianca,
            origem: 'llm',
            em_revisao: !confiante,
            ...comum,
          },
        });
        // Palpite duvidoso não entra no cache, senão se repetiria sem passar pela revisão.
        if (confiante) {
          const id = { descricao_original: item.descricao_original, cnpj };
          await tx.normalizationCache.upsert({
            where: { descricao_original_cnpj: id },
            create: { ...id, product_id: produto.id },
            update: { product_id: produto.id },
          });
        }
      }
    });
  }

  private async chamarIa(lote: ItemPendente[], correcoes: unknown[]) {
    let resposta: Response;
    try {
      resposta = await fetch(`${process.env.AI_URL}/normalize/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itens: lote.map((i) => ({
            id: i.id,
            descricao: i.descricao_original,
            unidade: i.unidade,
          })),
          correcoes,
        }),
        signal: AbortSignal.timeout(TIMEOUT_AI_MS),
      });
    } catch {
      throw new ServiceUnavailableException({ erro: 'ai_indisponivel' });
    }
    if (resposta.status === 503) return 'sem_llm' as const;
    if (!resposta.ok)
      throw new ServiceUnavailableException({ erro: 'llm_indisponivel' });
    return (await resposta.json()) as RespostaIa;
  }

  private async enviarParaRevisao(lote: ItemPendente[]) {
    await this.prisma.itemNormalization.createMany({
      data: lote.map((item) => ({
        receipt_item_id: item.id,
        confianca: 0,
        origem: 'llm' as const,
        em_revisao: true,
      })),
    });
  }
}
