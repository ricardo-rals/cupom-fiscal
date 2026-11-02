import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { NormalizationQueue } from '../normalization/normalization.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface CupomItem {
  codigo: string | null;
  descricao_original: string;
  quantidade: string;
  unidade: string;
  valor_unitario: string;
  valor_total: string;
}

interface Cupom {
  cnpj: string;
  nome: string;
  cidade: string | null;
  emitido_em: string;
  chave_acesso: string;
  itens: CupomItem[];
  total: string;
  desconto: string;
  acrescimo: string;
  pagamento: string | null;
}

const IMPORTACAO_POR_FOTO = 'importar_por_foto';
const TIMEOUT_AI_MS = 15_000;
// A URL vem do usuário e fica gravada quando a importação falha.
const PADRAO_CPF = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;
const LISTA_MAX = 200; // ponytail: sem paginação; adicionar quando houver mais cupons que isso
const TEXTO_MAX = 200;
const DESCRICAO_MAX = 500;
const UNIDADE_MAX = 20;
// Os limites são os das colunas decimais: valor fora deles viraria erro 500 no banco.
const VALOR = /^\d{1,10}(\.\d{1,2})?$/;
const VALOR_UNITARIO = /^\d{1,10}(\.\d{1,4})?$/;
const QUANTIDADE = /^\d{1,8}(\.\d{1,4})?$/;

type Corpo = Record<string, unknown> | undefined;

const invalido = (campo: string) =>
  new BadRequestException({ erro: 'campo_invalido', campo });

function texto(corpo: Corpo, campo: string, max: number, vazio = false) {
  const valor = corpo?.[campo];
  if (
    typeof valor !== 'string' ||
    valor.length > max ||
    (!vazio && !valor.trim())
  ) {
    throw invalido(campo);
  }
  // Texto digitado também não pode levar CPF para o banco.
  if (valor.search(PADRAO_CPF) !== -1)
    throw new BadRequestException({ erro: 'cpf_nao_permitido' });
  return valor.trim();
}

function numero(corpo: Corpo, campo: string, formato: RegExp) {
  const valor = corpo?.[campo];
  if (typeof valor !== 'string' || !formato.test(valor)) throw invalido(campo);
  return valor;
}

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: NormalizationQueue,
  ) {}

  async listar() {
    const cupons = await this.prisma.receipt.findMany({
      orderBy: { emitido_em: 'desc' },
      take: LISTA_MAX,
      include: { store: true, _count: { select: { items: true } } },
    });
    const pendentes = await this.prisma.receiptItem.findMany({
      where: {
        receipt_id: { in: cupons.map((c) => c.id) },
        normalization: { is: { em_revisao: true } },
      },
      select: { receipt_id: true },
    });
    return cupons.map((c) => ({
      id: c.id,
      mercado: c.store.nome,
      emitido_em: c.emitido_em,
      total: c.total,
      status: c.status,
      itens: c._count.items,
      em_revisao: pendentes.filter((p) => p.receipt_id === c.id).length,
    }));
  }

  async situacao(id: number) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id },
      include: {
        store: true,
        items: {
          orderBy: { id: 'asc' },
          include: {
            normalization: {
              include: { product: { include: { category: true } } },
            },
          },
        },
      },
    });
    if (!receipt) throw new NotFoundException({ erro: 'cupom_nao_encontrado' });
    return {
      id: receipt.id,
      status: receipt.status,
      origem: receipt.origem,
      parada:
        receipt.status === 'confirmado' && !(await this.fila.emAndamento(id)),
      mercado: receipt.store.nome,
      cnpj: receipt.store.cnpj,
      chave_acesso: receipt.chave_acesso,
      emitido_em: receipt.emitido_em,
      total: receipt.total,
      desconto: receipt.desconto,
      acrescimo: receipt.acrescimo,
      pagamento: receipt.pagamento,
      itens: receipt.items.length,
      em_revisao: receipt.items.filter((i) => i.normalization?.em_revisao)
        .length,
      lista: receipt.items.map((i) => ({
        id: i.id,
        codigo: i.codigo,
        descricao_original: i.descricao_original,
        quantidade: i.quantidade,
        unidade: i.unidade,
        valor_unitario: i.valor_unitario,
        valor_total: i.valor_total,
        em_revisao: i.normalization?.em_revisao ?? false,
        confianca: i.normalization?.confianca ?? null,
        origem: i.normalization?.origem ?? null,
        normalizacao: i.normalization?.product && {
          produto: i.normalization.product.nome_canonico,
          marca: i.normalization.product.marca,
          conteudo: i.normalization.product.conteudo,
          unidade_padrao: i.normalization.product.unidade_padrao,
          categoria: i.normalization.product.category.nome,
        },
      })),
    };
  }

  /** O nome do mercado vale para todos os cupons dele; CNPJ e chave identificam e não mudam. */
  async atualizar(id: number, corpo: Corpo) {
    const emitido = new Date(texto(corpo, 'emitido_em', TEXTO_MAX));
    if (Number.isNaN(emitido.getTime())) throw invalido('emitido_em');
    const pagamento = texto(corpo, 'pagamento', TEXTO_MAX, true);
    const dados = {
      emitido_em: emitido,
      total: numero(corpo, 'total', VALOR),
      desconto: numero(corpo, 'desconto', VALOR),
      acrescimo: numero(corpo, 'acrescimo', VALOR),
      pagamento: pagamento || null,
      store: { update: { nome: texto(corpo, 'mercado', TEXTO_MAX) } },
    };
    if (!(await this.prisma.receipt.findUnique({ where: { id } }))) {
      throw new NotFoundException({ erro: 'cupom_nao_encontrado' });
    }
    await this.prisma.receipt.update({ where: { id }, data: dados });
    return this.situacao(id);
  }

  /** Descrição nova invalida a normalização: o item volta para a fila. */
  async atualizarItem(id: number, itemId: number, corpo: Corpo) {
    const quantidade = numero(corpo, 'quantidade', QUANTIDADE);
    if (Number(quantidade) <= 0) throw invalido('quantidade'); // as views dividem por ela
    const codigo = corpo?.codigo;
    if (typeof codigo !== 'string' || codigo.length > TEXTO_MAX)
      throw invalido('codigo');
    const dados = {
      codigo: codigo.trim() || null,
      descricao_original: texto(corpo, 'descricao_original', DESCRICAO_MAX),
      quantidade,
      unidade: texto(corpo, 'unidade', UNIDADE_MAX),
      valor_unitario: numero(corpo, 'valor_unitario', VALOR_UNITARIO),
      valor_total: numero(corpo, 'valor_total', VALOR),
    };

    const item = await this.prisma.receiptItem.findFirst({
      where: { id: itemId, receipt_id: id },
      include: { receipt: true },
    });
    if (!item) throw new NotFoundException({ erro: 'item_nao_encontrado' });

    const renormalizar =
      dados.descricao_original !== item.descricao_original &&
      item.receipt.status !== 'rascunho';
    await this.prisma.$transaction(async (tx) => {
      await tx.receiptItem.update({ where: { id: itemId }, data: dados });
      if (renormalizar) {
        await tx.itemNormalization.deleteMany({
          where: { receipt_item_id: itemId },
        });
        await tx.receipt.update({
          where: { id },
          data: { status: 'confirmado' },
        });
      }
    });
    if (renormalizar && !(await this.fila.emAndamento(id)))
      await this.fila.enfileirar(id);
    return this.situacao(id);
  }

  /** Retoma cupom parado; com job vivo não faz nada, para não pagar o LLM duas vezes. */
  async retomar(id: number) {
    const situacao = await this.situacao(id);
    if (!situacao.parada) return situacao;
    await this.fila.enfileirar(id);
    return { ...situacao, parada: false };
  }

  /** Foto sai de `rascunho` aqui; repetir em cupom já confirmado não muda nada. */
  async confirmar(id: number) {
    const { count } = await this.prisma.receipt.updateMany({
      where: { id, status: 'rascunho' },
      data: { status: 'confirmado' },
    });
    const situacao = await this.situacao(id);
    if (count > 0) await this.fila.enfileirar(id);
    return situacao;
  }

  async importarPorQr(url: string) {
    const cupom = await this.consultarCupom(url);

    const existente = await this.buscarPorChave(cupom.chave_acesso);
    if (existente) throw this.jaImportado(existente.id);

    try {
      const salvo = await this.salvar(cupom);
      await this.fila.enfileirar(salvo.id);
      return salvo;
    } catch (erro) {
      // Dois envios simultâneos do mesmo cupom: o índice único decide.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002'
      ) {
        const atual = await this.buscarPorChave(cupom.chave_acesso);
        if (atual) throw this.jaImportado(atual.id);
      }
      throw erro;
    }
  }

  private buscarPorChave(chave_acesso: string) {
    return this.prisma.receipt.findUnique({ where: { chave_acesso } });
  }

  private async consultarCupom(url: string): Promise<Cupom> {
    let resposta: Response;
    try {
      resposta = await fetch(`${process.env.AI_URL}/nfce/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(TIMEOUT_AI_MS),
      });
    } catch {
      throw await this.falhaDeImportacao(
        url,
        'consulta',
        'ai_indisponivel',
        502,
      );
    }

    if (resposta.ok) return (await resposta.json()) as Cupom;
    if (resposta.status === 400) {
      throw new HttpException({ erro: 'url_nao_permitida' }, 400);
    }
    if (resposta.status === 422) {
      throw await this.falhaDeImportacao(
        url,
        'layout',
        'layout_nao_reconhecido',
        422,
      );
    }
    throw await this.falhaDeImportacao(url, 'consulta', 'consulta_falhou', 502);
  }

  private async falhaDeImportacao(
    url: string,
    etapa: string,
    mensagem: string,
    status: number,
  ) {
    await this.prisma.importError.create({
      data: { url: url.replace(PADRAO_CPF, '[cpf]'), etapa, mensagem },
    });
    return new HttpException(
      { erro: mensagem, sugestao: IMPORTACAO_POR_FOTO },
      status,
    );
  }

  private jaImportado(receiptId: number) {
    return new HttpException(
      {
        erro: 'cupom_ja_importado',
        mensagem: 'Este cupom já foi importado.',
        receipt_id: receiptId,
      },
      409,
    );
  }

  private async salvar(cupom: Cupom) {
    const loja = { cnpj: cupom.cnpj, nome: cupom.nome, cidade: cupom.cidade };
    const receipt = await this.prisma.receipt.create({
      data: {
        store: {
          connectOrCreate: { where: { cnpj: cupom.cnpj }, create: loja },
        },
        chave_acesso: cupom.chave_acesso,
        emitido_em: new Date(cupom.emitido_em),
        total: cupom.total,
        desconto: cupom.desconto,
        acrescimo: cupom.acrescimo,
        pagamento: cupom.pagamento,
        origem: 'qr',
        status: 'confirmado', // só a foto passa pela revisão antes de confirmar
        items: { create: cupom.itens },
      },
      include: { store: true, _count: { select: { items: true } } },
    });
    return {
      id: receipt.id,
      status: receipt.status,
      mercado: receipt.store.nome,
      emitido_em: receipt.emitido_em,
      total: receipt.total,
      itens: receipt._count.items,
    };
  }
}
