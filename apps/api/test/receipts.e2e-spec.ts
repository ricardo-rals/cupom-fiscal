import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

const CNPJ = '00000000000191';
const CHAVE = '29'.padEnd(44, '0');
const URL_QR = 'http://nfe.sefaz.ba.gov.br/teste-importacao';

const cupom = {
  cnpj: CNPJ,
  nome: 'MERCADO TESTE',
  cidade: 'SALVADOR',
  emitido_em: '2026-10-26T23:30:00-03:00',
  chave_acesso: CHAVE,
  itens: [
    {
      codigo: '1',
      descricao_original: 'SUCO D+ 200ML',
      quantidade: '1',
      unidade: 'UN',
      valor_unitario: '1.59',
      valor_total: '1.59',
    },
    {
      codigo: '1',
      descricao_original: 'SUCO D+ 200ML',
      quantidade: '3',
      unidade: 'UN',
      valor_unitario: '1.59',
      valor_total: '4.77',
    },
    {
      codigo: null,
      descricao_original: 'QJ MUSS kg',
      quantidade: '0.322',
      unidade: 'KG',
      valor_unitario: '47.98',
      valor_total: '15.45',
    },
  ],
  total: '21.81',
  desconto: '0',
  acrescimo: '0',
  pagamento: '99 - Outros',
};

describe('POST /receipts/qr', () => {
  let app: INestApplication<App>;
  let db: pg.Client;

  const aiResponde = (status: number, corpo: unknown = {}) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(corpo, { status })),
    );
  const enviar = () => request(app.getHttpServer()).post('/receipts/qr').send({ url: URL_QR });
  const contar = async (sql: string, valor: string) => {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${sql}`, [valor]);
    return rows[0].n as number;
  };
  const limpar = async () => {
    await db.query('DELETE FROM receipts WHERE chave_acesso = $1', [CHAVE]);
    await db.query('DELETE FROM stores WHERE cnpj = $1', [CNPJ]);
    await db.query('DELETE FROM import_errors WHERE url = $1', [URL_QR]);
  };

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  beforeEach(limpar);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await limpar();
    await db.end();
    await app.close();
  });

  it('salva cupom, loja e itens como confirmado', async () => {
    aiResponde(200, cupom);
    const resposta = await enviar().expect(201);
    expect(resposta.body).toMatchObject({
      status: 'confirmado',
      itens: 3,
      mercado: 'MERCADO TESTE',
    });

    const { rows } = await db.query(
      `SELECT r.origem, r.total::text, s.cnpj, s.cidade, count(*)::int AS itens,
              sum(i.valor_total)::text AS soma, r.emitido_em = '2026-10-27T02:30:00Z' AS instante_ok
       FROM receipts r
       JOIN stores s ON s.id = r.store_id
       JOIN receipt_items i ON i.receipt_id = r.id
       WHERE r.chave_acesso = $1
       GROUP BY r.id, s.id`,
      [CHAVE],
    );
    expect(rows).toEqual([
      {
        origem: 'qr',
        total: '21.81',
        cnpj: CNPJ,
        cidade: 'SALVADOR',
        itens: 3,
        soma: '21.81',
        instante_ok: true,
      },
    ]);
  });

  it('não duplica cupom já importado', async () => {
    aiResponde(200, cupom);
    const primeira = await enviar().expect(201);

    const segunda = await enviar().expect(409);
    expect(segunda.body).toMatchObject({
      erro: 'cupom_ja_importado',
      receipt_id: primeira.body.id,
    });
    expect(await contar('receipts WHERE chave_acesso = $1', CHAVE)).toBe(1);
  });

  it('dois envios simultâneos gravam um único cupom', async () => {
    aiResponde(200, cupom);
    const respostas = await Promise.all([enviar(), enviar()]);
    expect(respostas.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(await contar('receipts WHERE chave_acesso = $1', CHAVE)).toBe(1);
  });

  it('reaproveita a loja em outro cupom do mesmo CNPJ', async () => {
    aiResponde(200, cupom);
    await enviar().expect(201);
    await db.query('DELETE FROM receipts WHERE chave_acesso = $1', [CHAVE]);

    await enviar().expect(201);
    expect(await contar('stores WHERE cnpj = $1', CNPJ)).toBe(1);
  });

  it.each([
    [422, 'layout', 'layout_nao_reconhecido'],
    [502, 'consulta', 'consulta_falhou'],
  ])('ai responde %i: registra o erro e sugere a foto', async (status, etapa, mensagem) => {
    aiResponde(status);
    const resposta = await enviar().expect(status);
    expect(resposta.body).toEqual({ erro: mensagem, sugestao: 'importar_por_foto' });

    const { rows } = await db.query('SELECT etapa, mensagem FROM import_errors WHERE url = $1', [
      URL_QR,
    ]);
    expect(rows).toEqual([{ etapa, mensagem }]);
  });

  it('ai fora do ar: registra o erro e sugere a foto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const resposta = await enviar().expect(502);
    expect(resposta.body).toEqual({ erro: 'ai_indisponivel', sugestao: 'importar_por_foto' });
    expect(await contar('import_errors WHERE url = $1', URL_QR)).toBe(1);
  });

  it('url recusada pelo ai não vira erro de importação', async () => {
    aiResponde(400);
    await enviar().expect(400);
    expect(await contar('import_errors WHERE url = $1', URL_QR)).toBe(0);
  });

  it.each([[{}], [{ url: 123 }], [{ url: '   ' }], [{ url: 'x'.repeat(2049) }]])(
    'recusa corpo inválido %#',
    async (corpo) => {
      await request(app.getHttpServer()).post('/receipts/qr').send(corpo).expect(400);
    },
  );
});
