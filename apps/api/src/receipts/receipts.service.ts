import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
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

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async importarPorQr(url: string) {
    const cupom = await this.consultarCupom(url);

    const existente = await this.buscarPorChave(cupom.chave_acesso);
    if (existente) throw this.jaImportado(existente.id);

    try {
      return await this.salvar(cupom);
    } catch (erro) {
      // Dois envios simultâneos do mesmo cupom: o índice único decide.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
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
      throw await this.falhaDeImportacao(url, 'consulta', 'ai_indisponivel', 502);
    }

    if (resposta.ok) return (await resposta.json()) as Cupom;
    if (resposta.status === 400) {
      throw new HttpException({ erro: 'url_nao_permitida' }, 400);
    }
    if (resposta.status === 422) {
      throw await this.falhaDeImportacao(url, 'layout', 'layout_nao_reconhecido', 422);
    }
    throw await this.falhaDeImportacao(url, 'consulta', 'consulta_falhou', 502);
  }

  private async falhaDeImportacao(url: string, etapa: string, mensagem: string, status: number) {
    await this.prisma.importError.create({
      data: { url: url.replace(PADRAO_CPF, '[cpf]'), etapa, mensagem },
    });
    return new HttpException({ erro: mensagem, sugestao: IMPORTACAO_POR_FOTO }, status);
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
        store: { connectOrCreate: { where: { cnpj: cupom.cnpj }, create: loja } },
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
