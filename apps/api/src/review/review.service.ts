import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UnidadePadrao } from '../generated/prisma/client.js';
import { chaveDeProduto } from '../normalization/normalization.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface Resolucao {
  produto: string;
  marca: string;
  conteudo: number;
  unidade_padrao: UnidadePadrao;
  categoria: string;
}

const TEXTO_MAX = 200;
const CONTEUDO_MAX = 99_999_999;
const textoValido = (valor: unknown): valor is string =>
  typeof valor === 'string' && valor.length <= TEXTO_MAX;

function validar(
  corpo: Partial<Record<keyof Resolucao, unknown>> | undefined,
): Resolucao {
  const { produto, marca, conteudo, unidade_padrao, categoria } = corpo ?? {};
  if (
    !textoValido(produto) ||
    !produto.trim() ||
    !textoValido(marca) ||
    typeof conteudo !== 'number' ||
    !(conteudo > 0 && conteudo <= CONTEUDO_MAX) ||
    !Object.values(UnidadePadrao).includes(unidade_padrao as UnidadePadrao) ||
    typeof categoria !== 'string'
  ) {
    throw new BadRequestException({ erro: 'resolucao_invalida' });
  }
  return {
    produto,
    marca,
    conteudo,
    unidade_padrao: unidade_padrao as UnidadePadrao,
    categoria,
  };
}

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async listar() {
    const pendentes = await this.prisma.itemNormalization.findMany({
      where: { em_revisao: true },
      orderBy: { receipt_item_id: 'asc' },
      include: {
        product: { include: { category: true } },
        receiptItem: { include: { receipt: { include: { store: true } } } },
      },
    });
    return pendentes.map(
      ({ receipt_item_id, confianca, product, receiptItem }) => ({
        item_id: receipt_item_id,
        receipt_id: receiptItem.receipt_id,
        descricao_original: receiptItem.descricao_original,
        unidade: receiptItem.unidade,
        mercado: receiptItem.receipt.store.nome,
        emitido_em: receiptItem.receipt.emitido_em,
        confianca,
        sugestao: product && {
          produto: product.nome_canonico,
          marca: product.marca,
          conteudo: product.conteudo,
          unidade_padrao: product.unidade_padrao,
          categoria: product.category.nome,
        },
      }),
    );
  }

  async categorias() {
    const categorias = await this.prisma.category.findMany({
      where: { pai_id: { not: null } },
      orderBy: { nome: 'asc' },
    });
    return categorias.map((c) => c.nome);
  }

  async resolver(itemId: number, corpo: Parameters<typeof validar>[0]) {
    const resolucao = validar(corpo);
    const pendente = await this.prisma.itemNormalization.findFirst({
      where: { receipt_item_id: itemId, em_revisao: true },
      include: { receiptItem: true },
    });
    if (!pendente)
      throw new NotFoundException({ erro: 'item_fora_da_revisao' });
    return this.aplicar(
      itemId,
      pendente.receiptItem.descricao_original,
      resolucao,
    );
  }

  /** Corrige um item já normalizado, esteja ou não na fila (RF03). */
  async corrigir(itemId: number, corpo: Parameters<typeof validar>[0]) {
    const resolucao = validar(corpo);
    const atual = await this.prisma.itemNormalization.findUnique({
      where: { receipt_item_id: itemId },
      include: { receiptItem: true },
    });
    if (!atual) throw new NotFoundException({ erro: 'item_sem_normalizacao' });
    return this.aplicar(
      itemId,
      atual.receiptItem.descricao_original,
      resolucao,
    );
  }

  /** A correção vale para os itens iguais na fila e vira rótulo para as próximas compras. */
  private async aplicar(
    itemId: number,
    descricao: string,
    resolucao: Resolucao,
  ) {
    // Grupo não é aceito: o LLM e os rótulos usam sempre a categoria, nunca o grupo acima dela.
    const categoria = await this.prisma.category.findFirst({
      where: { nome: resolucao.categoria, pai_id: { not: null } },
    });
    if (!categoria)
      throw new BadRequestException({ erro: 'categoria_invalida' });

    const chave = chaveDeProduto(resolucao);

    return this.prisma.$transaction(async (tx) => {
      const produto = await tx.product.upsert({
        where: { nome_canonico_marca_conteudo_unidade_padrao: chave },
        create: { ...chave, category_id: categoria.id },
        update: { category_id: categoria.id },
      });
      await tx.userLabel.deleteMany({
        where: { descricao_original: descricao },
      });
      await tx.userLabel.create({
        data: {
          descricao_original: descricao,
          product_id: produto.id,
          category_id: categoria.id,
        },
      });
      const { count } = await tx.itemNormalization.updateMany({
        where: {
          OR: [
            { receipt_item_id: itemId },
            {
              em_revisao: true,
              receiptItem: { descricao_original: descricao },
            },
          ],
        },
        data: {
          product_id: produto.id,
          confianca: 1,
          origem: 'usuario',
          em_revisao: false,
        },
      });
      return { product_id: produto.id, itens_resolvidos: count };
    });
  }
}
