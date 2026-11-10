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
      const lotes: ItemPendente[][] = [];
      for (let i = 0; i < pendentes.length; i += TAMANHO_DO_LOTE)
        lotes.push(pendentes.slice(i, i + TAMANHO_DO_LOTE));
      // Só as chamadas à IA vão em paralelo: o tempo do cupom é o do lote mais lento.
      // A gravação segue em ordem, porque lotes diferentes podem criar o mesmo produto.
      const respostas = await Promise.allSettled(
        lotes.map((lote) => this.consultarLote(lote, correcoes)),
      );
      for (const [i, resposta] of respostas.entries()) {
        if (resposta.status === 'fulfilled')
          await this.gravarLote(lotes[i], resposta.value, cupom.store.cnpj);
      }
      // Os lotes bons ficam gravados; a falha devolve o cupom à fila só com o resto.
      const falha = respostas.find((r) => r.status === 'rejected');
      if (falha) throw falha.reason;
    }

    await this.prisma.receipt.update({
      where: { id: receiptId },
      data: { status: 'normalizado' },
    });
  }

  /** Correção do usuário vence o cache, e os dois evitam chamar o LLM. */
  private async resolverSemLlm(itens: ItemPendente[], cnpj: string) {
    const descricoes = [...new Set(itens.map((i) => i.descricao_original))];
    const [rotulos, caches] = await Promise.all([
      this.prisma.userLabel.findMany({
        where: { descricao_original: { in: descricoes } },
        orderBy: { id: 'asc' }, // o mais novo sobrescreve no Map
      }),
      this.prisma.normalizationCache.findMany({
        where: { cnpj, descricao_original: { in: descricoes } },
      }),
    ]);
    const correcoes = new Map(
      rotulos.map((r) => [r.descricao_original, r.product_id]),
    );
    const cache = new Map(
      caches.map((c) => [c.descricao_original, c.product_id]),
    );

    const pendentes: ItemPendente[] = [];
    const resolvidos = [];
    for (const item of itens) {
      const correcao = correcoes.get(item.descricao_original);
      const productId = correcao ?? cache.get(item.descricao_original);
      if (productId === undefined) pendentes.push(item);
      else
        resolvidos.push({
          receipt_item_id: item.id,
          product_id: productId,
          confianca: 1,
          origem: correcao !== undefined ? 'usuario' : 'cache',
        } as const);
    }
    await this.prisma.itemNormalization.createMany({ data: resolvidos });
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

  private async consultarLote(lote: ItemPendente[], correcoes: unknown[]) {
    if (await limiteDeGastoAtingido(this.prisma)) return 'sem_llm' as const;
    return this.chamarIa(lote, correcoes);
  }

  private async gravarLote(
    lote: ItemPendente[],
    resposta: RespostaIa | 'sem_llm',
    cnpj: string,
  ) {
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
