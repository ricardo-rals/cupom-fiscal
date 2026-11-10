import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { comLogin, DONO } from './login.js';

const CNPJ = '00000000000616';
const CHAVE = '22'.padEnd(44, '0');
const MODELO = 'teste-foto';

const rascunho = {
  cnpj: CNPJ,
  nome: 'MERCADO DA FOTO',
  emitido_em: '2026-11-08T10:15:32-03:00',
  chave_acesso: CHAVE,
  total: '12.40',
  desconto: '0',
  acrescimo: '0',
  itens: [
    {
      codigo: null,
      descricao_original: 'CAFE 500G 123.456.789-09',
      quantidade: '1',
      unidade: 'UN',
      valor_unitario: '12.40',
      valor_total: '12.40',
    },
    {
      codigo: null,
      descricao_original: 'LINHA MAL LIDA',
      quantidade: '0',
      unidade: 'UN',
      valor_unitario: '1',
      valor_total: '1',
    },
  ],
};

const chamada = {
  modelo: MODELO,
  tokens_in: 1,
  tokens_out: 1,
  custo: '0.000100',
  latencia_ms: 1,
};

describe('importação por foto (etapa 4)', () => {
  let app: INestApplication<App>;
  let db: pg.Client;
  let enviados: { url: string; corpo: Record<string, unknown> }[] = [];

  const iaResponde = (resposta: unknown, status = 200) => {
    enviados = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        enviados.push({ url, corpo: JSON.parse(init.body) });
        return Response.json(resposta, { status });
      }),
    );
  };
  const enviar = (corpo: object = {}) =>
    comLogin(app)
      .post('/receipts/foto')
      .send({ imagem: 'aW1hZ2Vt', ...corpo });
  const limpar = async () => {
    await db.query('DELETE FROM receipts WHERE chave_acesso = $1', [CHAVE]);
    await db.query(
      'DELETE FROM receipts WHERE store_id IN (SELECT id FROM stores WHERE cnpj = $1)',
      [CNPJ],
    );
    await db.query('DELETE FROM stores WHERE cnpj = $1', [CNPJ]);
    await db.query('DELETE FROM llm_calls WHERE modelo = $1', [MODELO]);
  };

  beforeAll(async () => {
    process.env.AI_URL = 'http://ai-teste';
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  beforeEach(limpar);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.query('UPDATE users SET usar_ia = true WHERE id = $1', [DONO]);
    await limpar();
    await app.close();
    await db.end();
  });

  it('texto lido vira rascunho conferível, sem CPF e sem linha impossível', async () => {
    iaResponde({ tipo: 'rascunho', rascunho, chamada });
    const { body } = await enviar({ usar_ia: true }).expect(201);

    expect(enviados[0]).toMatchObject({
      url: 'http://ai-teste/nfce/foto',
      corpo: { imagem: 'aW1hZ2Vt', usar_ia: true },
    });
    expect(body).toMatchObject({
      status: 'rascunho',
      origem: 'foto',
      mercado: 'MERCADO DA FOTO',
      chave_acesso: CHAVE,
      itens: 1,
    });
    expect(body.lista[0].descricao_original).toBe('CAFE 500G');
    const { rows } = await db.query(
      'SELECT finalidade FROM llm_calls WHERE modelo = $1 AND user_id = $2',
      [MODELO, DONO],
    );
    expect(rows).toEqual([{ finalidade: 'foto' }]);

    // Conferido, o usuário confirma e a normalização começa.
    const confirmado = await comLogin(app)
      .post(`/receipts/${body.id}/confirm`)
      .expect(200);
    expect(confirmado.body.status).toBe('confirmado');

    iaResponde({ tipo: 'rascunho', rascunho, chamada: null });
    const repetido = await enviar().expect(409);
    expect(repetido.body.receipt_id).toBe(body.id);
  });

  it('QR de Sefaz suportada segue pela consulta normal', async () => {
    const cupomSefaz = {
      cnpj: CNPJ,
      nome: 'MERCADO DO QR',
      cidade: null,
      emitido_em: '2026-11-08T10:15:32-03:00',
      chave_acesso: CHAVE,
      itens: [rascunho.itens[0]],
      total: '12.40',
      desconto: '0',
      acrescimo: '0',
      pagamento: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/nfce/foto')
          ? Response.json({ tipo: 'url', url: 'http://nfe.sefaz.ba.gov.br/x' })
          : Response.json(cupomSefaz),
      ),
    );
    const { body } = await enviar().expect(201);
    expect(body).toMatchObject({ status: 'confirmado', mercado: 'MERCADO DO QR' });
  });

  it('sem IA na preferência, a leitura vai sem LLM', async () => {
    await db.query('UPDATE users SET usar_ia = false WHERE id = $1', [DONO]);
    iaResponde({ tipo: 'rascunho', rascunho: { ...rascunho, chave_acesso: null }, chamada: null });
    await enviar().expect(201);
    expect(enviados[0].corpo.usar_ia).toBe(false);
  });

  it('recusa imagem inválida e avisa quando o OCR está fora', async () => {
    await comLogin(app).post('/receipts/foto').send({}).expect(400);
    iaResponde({ detail: 'imagem_invalida' }, 400);
    await enviar().expect(400);
    iaResponde({ detail: 'ocr_indisponivel' }, 503);
    const { body } = await enviar().expect(503);
    expect(body.erro).toBe('ocr_indisponivel');
  });
});
