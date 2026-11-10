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

type Resultado =
  | { origem: 'llm'; resposta: RespostaIa }
  | { origem: 'local'; itens: ItemNormalizado[] };

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

export const chaveDeProduto = (
  produto: {
    produto: string;
    marca: string;
    conteudo: number;
    unidade_padrao: UnidadePadrao;
  },
  user_id: number,
) => ({
  user_id,
  nome_canonico: canonico(produto.produto),
  marca: canonico(produto.marca),
  conteudo: produto.conteudo.toFixed(4),
  unidade_padrao: produto.unidade_padrao,
});

/** Vale para todo uso de LLM do usuário no mês: normalização e agente somam no mesmo limite. */
export async function limiteDeGastoAtingido(
  prisma: PrismaService,
  usuario: number,
) {
  const limite = Number(process.env.LLM_LIMITE_MENSAL_USD ?? 5);
  const agora = new Date();
  const inicioDoMes = new Date(
    Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1),
  );
  const { _sum } = await prisma.llmCall.aggregate({
    where: { user_id: usuario, criado_em: { gte: inicioDoMes } },
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

    const usuario = cupom.user_id;
    const cnpj = cupom.store.cnpj;
    const pendentes = await this.resolverSemLlm(cupom.items, cnpj, usuario);

    if (pendentes.length > 0) {
      const correcoes = await this.correcoes(usuario);
      const lotes: ItemPendente[][] = [];
      for (let i = 0; i < pendentes.length; i += TAMANHO_DO_LOTE)
        lotes.push(pendentes.slice(i, i + TAMANHO_DO_LOTE));
      // Só as chamadas à IA vão em paralelo: o tempo do cupom é o do lote mais lento.
      // A gravação segue em ordem, porque lotes diferentes podem criar o mesmo produto.
      const respostas = await Promise.allSettled(
        lotes.map((lote) =>
          this.consultarLote(lote, correcoes, usuario, cupom.usar_ia),
        ),
      );
      for (const [i, resposta] of respostas.entries()) {
        if (resposta.status === 'fulfilled')
          await this.gravarLote(lotes[i], resposta.value, cnpj, usuario);
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
  private async resolverSemLlm(
    itens: ItemPendente[],
    cnpj: string,
    usuario: number,
  ) {
    const descricoes = [...new Set(itens.map((i) => i.descricao_original))];
    const [rotulos, caches] = await Promise.all([
      this.prisma.userLabel.findMany({
        where: { user_id: usuario, descricao_original: { in: descricoes } },
        orderBy: { id: 'asc' }, // o mais novo sobrescreve no Map
      }),
      this.prisma.normalizationCache.findMany({
        where: {
          user_id: usuario,
          cnpj,
          descricao_original: { in: descricoes },
        },
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

  private async correcoes(usuario: number) {
    const rotulos = await this.prisma.userLabel.findMany({
      where: { user_id: usuario },
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

  /** Sem IA, no limite de gasto ou sem chave do LLM, o modelo local resolve o lote. */
  private async consultarLote(
    lote: ItemPendente[],
    correcoes: unknown[],
    usuario: number,
    usarIa: boolean,
  ): Promise<Resultado> {
    if (usarIa && !(await limiteDeGastoAtingido(this.prisma, usuario))) {
      const resposta = await this.chamarIa<RespostaIa>(
        '/normalize/batch',
        lote,
        correcoes,
      );
      if (resposta !== 'sem_llm') return { origem: 'llm', resposta };
    }
    const local = await this.chamarIa<{ itens: ItemNormalizado[] }>(
      '/normalize/local',
      lote,
      correcoes,
    );
    if (local === 'sem_llm')
      throw new ServiceUnavailableException({ erro: 'ai_indisponivel' });
    return { origem: 'local', itens: local.itens };
  }

  private async gravarLote(
    lote: ItemPendente[],
    resultado: Resultado,
    cnpj: string,
    usuario: number,
  ) {
    const local = resultado.origem === 'local';
    const itens = local ? resultado.itens : resultado.resposta.itens;
    // O modelo local é menos confiante por natureza: a probabilidade se divide entre 43 categorias.
    const limiar = Number(
      local
        ? (process.env.NORMALIZACAO_LIMIAR_LOCAL ?? 0.5)
        : (process.env.NORMALIZACAO_LIMIAR ?? 0.8),
    );
    const porId = new Map(itens.map((item) => [item.id, item]));
    const categorias = new Map(
      (await this.prisma.category.findMany()).map((c) => [c.nome, c.id]),
    );

    await this.prisma.$transaction(async (tx) => {
      const comum = { origem: resultado.origem };
      if (resultado.origem === 'llm') {
        const chamada = await tx.llmCall.create({
          data: {
            user_id: usuario,
            finalidade: FINALIDADE,
            ...resultado.resposta.chamada,
          },
        });
        Object.assign(comum, {
          llm_call_id: chamada.id,
          prompt_version: resultado.resposta.prompt_version,
        });
      }

      for (const item of lote) {
        const normalizado = porId.get(item.id);
        const categoryId = normalizado && categorias.get(normalizado.categoria);
        if (!normalizado || categoryId === undefined) {
          await tx.itemNormalization.create({
            data: {
              receipt_item_id: item.id,
              confianca: 0,
              em_revisao: true,
              ...comum,
            },
          });
          continue;
        }

        const chave = chaveDeProduto(normalizado, usuario);
        const produto = await tx.product.upsert({
          where: { user_id_nome_canonico_marca_conteudo_unidade_padrao: chave },
          create: { ...chave, category_id: categoryId },
          update: {},
        });
        const confiante = normalizado.confianca >= limiar;
        await tx.itemNormalization.create({
          data: {
            receipt_item_id: item.id,
            product_id: produto.id,
            confianca: normalizado.confianca,
            em_revisao: !confiante,
            ...comum,
          },
        });
        // Palpite duvidoso não entra no cache, senão se repetiria sem passar pela revisão.
        // Resultado local também não: no próximo cupom com IA, o LLM tem a chance de melhorar o nome.
        if (confiante && !local) {
          const id = {
            user_id: usuario,
            descricao_original: item.descricao_original,
            cnpj,
          };
          await tx.normalizationCache.upsert({
            where: { user_id_descricao_original_cnpj: id },
            create: { ...id, product_id: produto.id },
            update: { product_id: produto.id },
          });
        }
      }
    });
  }

  /** 503 é LLM sem chave ou com chave recusada: quem chama cai para o modelo local. */
  private async chamarIa<T>(
    caminho: string,
    lote: ItemPendente[],
    correcoes: unknown[],
  ): Promise<T | 'sem_llm'> {
    let resposta: Response;
    try {
      resposta = await fetch(`${process.env.AI_URL}${caminho}`, {
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
    if (resposta.status === 503) return 'sem_llm';
    if (!resposta.ok)
      throw new ServiceUnavailableException({ erro: 'llm_indisponivel' });
    return (await resposta.json()) as T;
  }
}
