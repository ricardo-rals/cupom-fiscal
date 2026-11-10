import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  alerta,
  Compra,
  listaDeCompras,
  mediaRecente,
  MESES_DA_MEDIA,
  mesesAnteriores,
} from './calculos.js';

interface LinhaGasto {
  mes: string;
  categoria: string;
  total: number;
}

interface PrevisaoIa {
  modelo: string;
  previsoes: {
    mes: string;
    previsto: number;
    inferior: number;
    superior: number;
  }[];
}

const MESES_DE_HISTORICO = 24;
const MESES_PARA_MODELO = 6; // o mínimo do modelo de previsão do ai
const TIMEOUT_AI_MS = 30_000;
const VALOR = /^\d{1,10}(\.\d{1,2})?$/;

/** Mês e dia de hoje no fuso dos cupons. */
const hoje = () =>
  new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

@Injectable()
export class GastosService {
  private readonly logger = new Logger(GastosService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Gasto por mês e categoria, com o mesmo recorte do dashboard e das views. */
  private gastoPorMes(usuario: number, desde: string) {
    return this.prisma.$queryRaw<LinhaGasto[]>`
      SELECT to_char(r.emitido_em AT TIME ZONE 'America/Bahia', 'YYYY-MM') AS mes,
             c.nome AS categoria,
             sum(i.valor_total - i.desconto)::float8 AS total
      FROM receipt_items i
      JOIN receipts r ON r.id = i.receipt_id
      JOIN item_normalizations n ON n.receipt_item_id = i.id
      JOIN products p ON p.id = n.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE r.user_id = ${usuario} AND r.status = 'normalizado' AND NOT n.em_revisao
        AND (r.emitido_em AT TIME ZONE 'America/Bahia')::date >= ${desde}::date
      GROUP BY 1, 2`;
  }

  async orcamentos(usuario: number) {
    const mes = hoje().slice(0, 7);
    const [orcamentos, gastos] = await Promise.all([
      this.prisma.budget.findMany({
        where: { user_id: usuario },
        include: { category: true },
      }),
      this.gastoPorMes(usuario, `${mes}-01`),
    ]);
    const gastoDe = new Map(gastos.map((g) => [g.categoria, g.total]));
    return orcamentos
      .map((o) => {
        const valor = Number(o.valor_mensal);
        const gasto = gastoDe.get(o.category.nome) ?? 0;
        return {
          categoria: o.category.nome,
          valor,
          gasto_mes: Math.round(gasto * 100) / 100,
          pct: Math.round((gasto / valor) * 1000) / 10,
          alerta: alerta(gasto, valor),
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }

  /** Valor zero tira o orçamento da categoria. */
  async definirOrcamento(
    usuario: number,
    corpo: { categoria?: unknown; valor?: unknown } | undefined,
  ) {
    const { categoria, valor } = corpo ?? {};
    if (typeof valor !== 'string' || !VALOR.test(valor))
      throw new BadRequestException({ erro: 'campo_invalido', campo: 'valor' });
    const alvo =
      typeof categoria === 'string'
        ? await this.prisma.category.findFirst({
            where: { nome: categoria, pai_id: { not: null } },
          })
        : null;
    if (!alvo) throw new BadRequestException({ erro: 'categoria_invalida' });

    const chave = { user_id: usuario, category_id: alvo.id };
    if (Number(valor) === 0)
      await this.prisma.budget.deleteMany({ where: chave });
    else
      await this.prisma.budget.upsert({
        where: { user_id_category_id: chave },
        create: { ...chave, valor_mensal: valor },
        update: { valor_mensal: valor },
      });
    return this.orcamentos(usuario);
  }

  /**
   * Previsão do mês atual. Total: o modelo de previsão do ai quando há 6 meses fechados com
   * compra; senão, a média dos últimos 3 meses. Categoria: sempre a média dos 3 meses, porque
   * mês sem compra numa categoria é zero de verdade, e o modelo interpolaria um valor.
   */
  async previsao(usuario: number) {
    const dia = hoje();
    const mes = dia.slice(0, 7);
    const [inicio] = mesesAnteriores(mes, MESES_DE_HISTORICO);
    const [linhas, orcamentos] = await Promise.all([
      this.gastoPorMes(usuario, `${inicio}-01`),
      this.prisma.budget.findMany({
        where: { user_id: usuario },
        include: { category: true },
      }),
    ]);

    const totalPorMes = new Map<string, number>();
    const porCategoria = new Map<string, Map<string, number>>();
    for (const { mes: m, categoria, total } of linhas) {
      totalPorMes.set(m, (totalPorMes.get(m) ?? 0) + total);
      const meses = porCategoria.get(categoria) ?? new Map<string, number>();
      meses.set(m, total);
      porCategoria.set(categoria, meses);
    }

    const fechados = [...totalPorMes]
      .filter(([m, total]) => m < mes && total > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const modelo =
      fechados.length >= MESES_PARA_MODELO
        ? await this.preverTotal(fechados, mes)
        : null;
    const media = mediaRecente(totalPorMes, mes);
    const orcamentoDe = new Map(
      orcamentos.map((o) => [o.category.nome, Number(o.valor_mensal)]),
    );
    const arredondar = (v: number) => Math.round(v * 100) / 100;

    return {
      mes,
      meses_com_compra: fechados.length,
      total: {
        metodo: modelo ? modelo.modelo : `media_${MESES_DA_MEDIA}_meses`,
        previsto: arredondar(modelo?.previsto ?? media),
        inferior: modelo ? arredondar(modelo.inferior) : null,
        superior: modelo ? arredondar(modelo.superior) : null,
        gasto_ate_agora: arredondar(totalPorMes.get(mes) ?? 0),
      },
      categorias: [...porCategoria]
        .map(([categoria, meses]) => ({
          categoria,
          previsto: arredondar(mediaRecente(meses, mes)),
          gasto_ate_agora: arredondar(meses.get(mes) ?? 0),
          orcamento: orcamentoDe.get(categoria) ?? null,
        }))
        .filter((c) => c.previsto > 0 || c.gasto_ate_agora > 0)
        .sort((a, b) => b.previsto - a.previsto),
    };
  }

  /** Falha do ai não derruba a previsão: quem chama cai para a média. */
  private async preverTotal(fechados: [string, number][], mes: string) {
    try {
      const resposta = await fetch(`${process.env.AI_URL}/forecast/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          series: [
            {
              id: 'total',
              pontos: fechados.map(([m, valor]) => ({ mes: m, valor })),
            },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_AI_MS),
      });
      if (!resposta.ok) return null;
      const { total } = (await resposta.json()) as {
        total: PrevisaoIa | null;
      };
      const doMes = total?.previsoes.find((p) => p.mes === mes);
      return doMes && total ? { modelo: total.modelo, ...doMes } : null;
    } catch (erro) {
      this.logger.warn(`previsão de gasto pela média: ${(erro as Error).name}`);
      return null;
    }
  }

  async listaDeCompras(usuario: number) {
    const compras = await this.prisma.$queryRaw<Compra[]>`
      SELECT p.id AS produto, p.nome_canonico AS nome, p.marca,
             to_char(r.emitido_em AT TIME ZONE 'America/Bahia', 'YYYY-MM-DD') AS dia,
             sum(i.quantidade)::float8 AS quantidade,
             sum(i.valor_total - i.desconto)::float8 AS valor
      FROM receipt_items i
      JOIN receipts r ON r.id = i.receipt_id
      JOIN item_normalizations n ON n.receipt_item_id = i.id
      JOIN products p ON p.id = n.product_id
      WHERE r.user_id = ${usuario} AND r.status = 'normalizado' AND NOT n.em_revisao
        AND r.emitido_em > now() - interval '365 days'
      GROUP BY 1, 2, 3, 4`;
    return listaDeCompras(compras, hoje());
  }
}
