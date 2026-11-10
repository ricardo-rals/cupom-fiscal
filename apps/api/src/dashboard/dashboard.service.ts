import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface Filtros {
  from?: string;
  to?: string;
  category?: string;
  store?: string;
  q?: string;
}

const UM_DIA_MS = 86_400_000;
const FUSO = '-03:00'; // America/Bahia, sem horário de verão: o mesmo dia das views
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function dia(valor: string | undefined, campo: string) {
  const data = new Date(`${valor}T00:00:00${FUSO}`);
  if (!valor || !DATA.test(valor) || Number.isNaN(data.getTime())) {
    throw new BadRequestException({ erro: 'periodo_invalido', campo });
  }
  return data;
}

const paraDia = (instante: Date) =>
  new Date(instante.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

const contem = (texto: string) => ({
  contains: texto,
  mode: 'insensitive' as const,
});

/** O mesmo recorte das views: fora rascunho, cupom não normalizado e item em revisão. */
const comprasValidas = (
  inicio: Date,
  fim: Date,
  filtros: {
    usuario: number;
    store?: number;
    category?: string;
    product?: number;
    busca?: string;
  },
): Prisma.ReceiptItemWhereInput => ({
  // Texto em qualquer lugar: descrição do cupom, produto normalizado, marca ou mercado.
  ...(filtros.busca && {
    OR: [
      { descricao_original: contem(filtros.busca) },
      { receipt: { store: { nome: contem(filtros.busca) } } },
      {
        normalization: {
          is: {
            product: {
              is: {
                OR: [
                  { nome_canonico: contem(filtros.busca) },
                  { marca: contem(filtros.busca) },
                ],
              },
            },
          },
        },
      },
    ],
  }),
  receipt: {
    user_id: filtros.usuario,
    status: 'normalizado',
    emitido_em: { gte: inicio, lt: fim },
    store_id: filtros.store,
  },
  normalization: {
    is: {
      em_revisao: false,
      product: {
        is: { id: filtros.product, category: { nome: filtros.category } },
      },
    },
  },
});

function somarPor<T>(
  linhas: T[],
  chave: (linha: T) => string | number,
  valor: (linha: T) => Prisma.Decimal,
) {
  const grupos = new Map<
    string | number,
    { linha: T; total: Prisma.Decimal }
  >();
  for (const linha of linhas) {
    const atual = grupos.get(chave(linha));
    if (atual) atual.total = atual.total.plus(valor(linha));
    else grupos.set(chave(linha), { linha, total: valor(linha) });
  }
  return [...grupos.values()].sort((a, b) => b.total.comparedTo(a.total));
}

const valorPago = (item: {
  valor_total: Prisma.Decimal;
  desconto: Prisma.Decimal;
}) => item.valor_total.minus(item.desconto);

const somar = (itens: Parameters<typeof valorPago>[0][]) =>
  itens.reduce(
    (total, item) => total.plus(valorPago(item)),
    new Prisma.Decimal(0),
  );

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async resumo({ from, to, category, store, q }: Filtros, usuario: number) {
    const inicio = dia(from, 'from');
    const ultimoDia = dia(to, 'to');
    if (ultimoDia < inicio)
      throw new BadRequestException({ erro: 'periodo_invalido', campo: 'to' });
    const lojaId = store ? Number(store) : undefined;
    if (lojaId !== undefined && !Number.isInteger(lojaId)) {
      throw new BadRequestException({ erro: 'mercado_invalido' });
    }

    const fim = new Date(ultimoDia.getTime() + UM_DIA_MS);
    const duracao = fim.getTime() - inicio.getTime();
    const inicioAnterior = new Date(inicio.getTime() - duracao);
    const recorte = {
      usuario,
      store: lojaId,
      category: category || undefined,
      busca: q?.trim().slice(0, 100) || undefined,
    };

    const [itens, anteriores, categorias, mercados] = await Promise.all([
      this.prisma.receiptItem.findMany({
        where: comprasValidas(inicio, fim, recorte),
        include: {
          receipt: { include: { store: true } },
          normalization: {
            include: { product: { include: { category: true } } },
          },
        },
      }),
      this.prisma.receiptItem.findMany({
        where: comprasValidas(inicioAnterior, inicio, recorte),
        select: { valor_total: true, desconto: true },
      }),
      this.prisma.category.findMany({
        where: { pai_id: { not: null } },
        orderBy: { nome: 'asc' },
      }),
      this.prisma.store.findMany({
        where: { user_id: usuario },
        orderBy: { nome: 'asc' },
      }),
    ]);

    const total = somar(itens);
    const totalAnterior = somar(anteriores);
    const produto = (item: (typeof itens)[number]) =>
      item.normalization!.product!;

    return {
      from,
      to,
      total,
      cupons: new Set(itens.map((i) => i.receipt_id)).size,
      anterior: {
        from: paraDia(inicioAnterior),
        to: paraDia(new Date(inicio.getTime() - 1)),
        total: totalAnterior,
        variacao_pct: totalAnterior.isZero()
          ? null
          : total
              .minus(totalAnterior)
              .div(totalAnterior)
              .times(100)
              .toDecimalPlaces(1),
      },
      // Ordem cronológica: o web agrupa em semana ou mês quando o período é longo.
      por_dia: somarPor(itens, (i) => paraDia(i.receipt.emitido_em), valorPago)
        .map((g) => ({
          dia: paraDia(g.linha.receipt.emitido_em),
          total: g.total,
        }))
        .sort((a, b) => a.dia.localeCompare(b.dia)),
      por_categoria: somarPor(
        itens,
        (i) => produto(i).category_id,
        valorPago,
      ).map((g) => ({
        nome: produto(g.linha).category.nome,
        total: g.total,
      })),
      por_mercado: somarPor(itens, (i) => i.receipt.store_id, valorPago).map(
        (g) => ({
          id: g.linha.receipt.store_id,
          nome: g.linha.receipt.store.nome,
          total: g.total,
        }),
      ),
      por_produto: somarPor(itens, (i) => produto(i).id, valorPago).map(
        (g) => ({
          id: produto(g.linha).id,
          nome: produto(g.linha).nome_canonico,
          marca: produto(g.linha).marca,
          total: g.total,
        }),
      ),
      opcoes: {
        categorias: categorias.map((c) => c.nome),
        mercados: mercados.map((m) => ({ id: m.id, nome: m.nome })),
      },
    };
  }

  async precos(id: number, usuario: number) {
    const produto = await this.prisma.product.findFirst({
      where: { id, user_id: usuario },
      include: { category: true },
    });
    if (!produto)
      throw new NotFoundException({ erro: 'produto_nao_encontrado' });

    const itens = await this.prisma.receiptItem.findMany({
      where: comprasValidas(new Date(0), new Date('9999-01-01'), {
        usuario,
        product: id,
      }),
      include: { receipt: { include: { store: true } } },
      orderBy: [{ receipt: { emitido_em: 'asc' } }, { id: 'asc' }],
    });

    return {
      id: produto.id,
      produto: produto.nome_canonico,
      marca: produto.marca,
      conteudo: produto.conteudo,
      unidade_padrao: produto.unidade_padrao,
      categoria: produto.category.nome,
      pontos: itens.map((item) => {
        const unitario = valorPago(item).div(item.quantidade);
        return {
          item_id: item.id,
          receipt_id: item.receipt_id,
          emitido_em: item.receipt.emitido_em,
          mercado: item.receipt.store.nome,
          quantidade: item.quantidade,
          unidade: item.unidade,
          preco_unitario: unitario.toDecimalPlaces(4),
          preco_padrao: unitario.div(produto.conteudo).toDecimalPlaces(4),
        };
      }),
    };
  }
}
