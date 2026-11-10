import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { NormalizationQueue } from '../normalization/normalization.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface LinhaMensal {
  produto: number;
  categoria: number;
  mes: string;
  valor: number;
}

interface Previsao {
  modelo: string;
  mae_validacao: number;
  ultimo: number;
  previsoes: {
    mes: string;
    previsto: number;
    inferior: number;
    superior: number;
  }[];
}

const FILA = 'previsao';
const MESES_MIN = 6; // RF08
const TIMEOUT_AI_MS = 60_000;
// Erro médio nos meses reservados, relativo ao último preço.
const SELO = [
  { ate: 0.05, nivel: 'alta' },
  { ate: 0.15, nivel: 'media' },
  { ate: Infinity, nivel: 'baixa' },
] as const;

// ponytail: Map.groupBy pede a lib ES2024; trocar quando o tsconfig subir de versão.
function agrupar<T, K>(itens: T[], chave: (item: T) => K) {
  const grupos = new Map<K, T[]>();
  for (const item of itens)
    grupos.set(chave(item), [...(grupos.get(chave(item)) ?? []), item]);
  return grupos;
}

const selo = (erro: number) => SELO.find((s) => erro <= s.ate)!.nivel;

@Injectable()
export class ForecastService implements OnModuleInit {
  private readonly logger = new Logger(ForecastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: NormalizationQueue,
  ) {}

  async onModuleInit() {
    await this.fila.boss.createQueue(FILA);
    if (process.env.NORMALIZACAO_WORKER === 'off') return;
    await this.fila.boss.work(FILA, async () => {
      await this.rodarTodos();
    });
    // Todo dia 1º, depois do fechamento do mês anterior.
    await this.fila.boss.schedule(FILA, '0 6 1 * *', null, {
      tz: 'America/Bahia',
    });
  }

  /** Preço médio por unidade padrão em cada mês, com o mesmo recorte das views. */
  private serieMensal(usuario: number, produtoId?: number) {
    return this.prisma.$queryRaw<LinhaMensal[]>`
      SELECT p.id AS produto, p.category_id AS categoria,
             to_char(r.emitido_em AT TIME ZONE 'America/Bahia', 'YYYY-MM') AS mes,
             avg((i.valor_total - i.desconto) / i.quantidade / p.conteudo)::float8 AS valor
      FROM receipt_items i
      JOIN receipts r ON r.id = i.receipt_id
      JOIN item_normalizations n ON n.receipt_item_id = i.id
      JOIN products p ON p.id = n.product_id
      WHERE r.status = 'normalizado' AND NOT n.em_revisao AND r.user_id = ${usuario}
        AND (${produtoId ?? null}::int IS NULL OR p.id = ${produtoId ?? null}::int)
      GROUP BY 1, 2, 3
      ORDER BY 3`;
  }

  /**
   * Índice da categoria: cada preço dividido pela média do próprio produto, e a média disso
   * por mês. Assim um queijo de R$ 50/kg e outro de R$ 30/kg contam a mesma variação.
   */
  private indicesDeCategoria(linhas: LinhaMensal[]) {
    const porProduto = agrupar(linhas, (l) => l.produto);
    const razoes = new Map<number, Map<string, number[]>>();
    for (const serie of porProduto.values()) {
      if (serie.length < 2) continue; // um mês só não mostra variação nenhuma
      const media = serie.reduce((soma, l) => soma + l.valor, 0) / serie.length;
      for (const l of serie) {
        const meses = razoes.get(l.categoria) ?? new Map<string, number[]>();
        meses.set(l.mes, [...(meses.get(l.mes) ?? []), l.valor / media]);
        razoes.set(l.categoria, meses);
      }
    }
    return [...razoes].map(([categoria, meses]) => ({
      categoria,
      pontos: [...meses].map(([mes, valores]) => ({
        mes,
        valor: valores.reduce((a, b) => a + b, 0) / valores.length,
      })),
    }));
  }

  /** O job mensal refaz as previsões de todos os usuários. */
  async rodarTodos() {
    const usuarios = await this.prisma.user.findMany({ select: { id: true } });
    for (const { id } of usuarios) await this.rodar(id);
  }

  /** Refaz as previsões do usuário; produto com poucos meses usa a da categoria na leitura. */
  async rodar(usuario: number) {
    const linhas = await this.serieMensal(usuario);
    if (!linhas.length) return { produtos: 0, categorias: 0 };
    const produtos = [...agrupar(linhas, (l) => l.produto)]
      .filter(([, serie]) => serie.length >= MESES_MIN)
      .map(([produto, serie]) => ({
        id: `p${produto}`,
        pontos: serie.map(({ mes, valor }) => ({ mes, valor })),
      }));
    const categorias = this.indicesDeCategoria(linhas).map((c) => ({
      id: `c${c.categoria}`,
      pontos: c.pontos,
    }));

    let resposta: Response;
    try {
      resposta = await fetch(`${process.env.AI_URL}/forecast/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series: [...produtos, ...categorias] }),
        signal: AbortSignal.timeout(TIMEOUT_AI_MS),
      });
    } catch {
      throw new ServiceUnavailableException({ erro: 'ai_indisponivel' });
    }
    if (!resposta.ok)
      throw new ServiceUnavailableException({ erro: 'previsao_falhou' });
    const resultado = (await resposta.json()) as Record<
      string,
      Previsao | null
    >;

    const linhasNovas: Prisma.ForecastCreateManyInput[] = [];
    for (const [id, previsao] of Object.entries(resultado)) {
      if (!previsao) continue;
      const alvo = Number(id.slice(1));
      const daCategoria = id.startsWith('c');
      // Categoria é guardada como multiplicador do último índice: 1,02 é alta de 2%.
      const escala = daCategoria ? previsao.ultimo : 1;
      for (const p of previsao.previsoes) {
        linhasNovas.push({
          user_id: usuario,
          product_id: daCategoria ? null : alvo,
          category_id: daCategoria ? alvo : null,
          mes: new Date(`${p.mes}-01`),
          previsto: p.previsto / escala,
          limite_inferior: p.inferior / escala,
          limite_superior: p.superior / escala,
          modelo: previsao.modelo,
          mae_validacao: previsao.mae_validacao / escala,
        });
      }
    }
    await this.prisma.$transaction([
      this.prisma.forecast.deleteMany({ where: { user_id: usuario } }),
      this.prisma.forecast.createMany({ data: linhasNovas }),
    ]);
    this.logger.log(`previsões gravadas: ${linhasNovas.length}`);
    return {
      produtos: new Set(linhasNovas.map((l) => l.product_id).filter(Boolean))
        .size,
      categorias: new Set(linhasNovas.map((l) => l.category_id).filter(Boolean))
        .size,
    };
  }

  async porProduto(id: number, usuario: number) {
    const produto = await this.prisma.product.findFirst({
      where: { id, user_id: usuario },
      include: { category: true },
    });
    if (!produto)
      throw new NotFoundException({ erro: 'produto_nao_encontrado' });

    const serie = await this.serieMensal(usuario, id);
    const ultimo = serie.at(-1)?.valor;
    const base = {
      categoria: produto.category.nome,
      meses_observados: serie.length,
    };

    const proprias = await this.prisma.forecast.findMany({
      where: { product_id: id },
      orderBy: { mes: 'asc' },
    });
    const daCategoria =
      proprias.length || ultimo === undefined
        ? []
        : await this.prisma.forecast.findMany({
            where: { user_id: usuario, category_id: produto.category_id },
            orderBy: { mes: 'asc' },
          });
    const linhas = proprias.length ? proprias : daCategoria;
    if (!linhas.length || ultimo === undefined) {
      return { ...base, tipo: 'insuficiente', meses_minimos: MESES_MIN };
    }

    const escala = proprias.length ? 1 : ultimo;
    const erro =
      Number(linhas[0].mae_validacao) / (proprias.length ? ultimo : 1);
    return {
      ...base,
      tipo: proprias.length ? 'produto' : 'categoria',
      modelo: linhas[0].modelo,
      erro_pct: erro,
      selo: selo(erro),
      gerado_em: linhas[0].criado_em,
      previsoes: linhas.map((l) => ({
        mes: l.mes.toISOString().slice(0, 7),
        previsto: Number(l.previsto) * escala,
        inferior: Number(l.limite_inferior) * escala,
        superior: Number(l.limite_superior) * escala,
      })),
    };
  }
}
