import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { assinarToken } from '../src/auth/token.js';
import { comLogin, DONO } from './login.js';

const CNPJ = '00000000000515';
const CHAVE = '23'.padEnd(44, '0');
const MARCADOR = 'teste isolamento';
const OUTRO = { sub: 'teste-outro', email: 'outro@teste.local', nome: 'Outro' };

describe('cada usuário vê só os próprios dados', () => {
  let app: INestApplication<App>;
  let db: pg.Client;
  let cupom: number;
  let item: number;
  let produto: number;

  const dono = () => comLogin(app);
  const outro = () => comLogin(app, OUTRO);

  const limpar = async () => {
    await db.query('DELETE FROM receipts WHERE chave_acesso = $1', [CHAVE]);
    await db.query('DELETE FROM stores WHERE cnpj = $1', [CNPJ]);
    await db.query('DELETE FROM user_labels WHERE descricao_original = $1', [
      'TESTE-ISOLAMENTO',
    ]);
    await db.query('DELETE FROM products WHERE nome_canonico LIKE $1', [
      `${MARCADOR}%`,
    ]);
  };

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await limpar();
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    await app.init();

    const { rows: lojas } = await db.query<{ id: number }>(
      `INSERT INTO stores (user_id, cnpj, nome) VALUES ($1, $2, 'LOJA DO DONO') RETURNING id`,
      [DONO, CNPJ],
    );
    const { rows: produtos } = await db.query<{ id: number }>(
      `INSERT INTO products (user_id, nome_canonico, conteudo, unidade_padrao, category_id)
       SELECT $1, $2, 1, 'l', id FROM categories WHERE nome = 'Leite' RETURNING id`,
      [DONO, `${MARCADOR} leite`],
    );
    produto = produtos[0].id;
    const { rows: cupons } = await db.query<{ id: number }>(
      `INSERT INTO receipts (user_id, store_id, chave_acesso, emitido_em, total, origem, status)
       VALUES ($1, $2, $3, now(), 7, 'qr', 'normalizado') RETURNING id`,
      [DONO, lojas[0].id, CHAVE],
    );
    cupom = cupons[0].id;
    const { rows: itens } = await db.query<{ id: number }>(
      `INSERT INTO receipt_items
         (receipt_id, descricao_original, quantidade, unidade, valor_unitario, valor_total)
       VALUES ($1, 'TESTE-ISOLAMENTO', 1, 'UN', 7, 7) RETURNING id`,
      [cupom],
    );
    item = itens[0].id;
    await db.query(
      `INSERT INTO item_normalizations (receipt_item_id, product_id, confianca, origem, em_revisao)
       VALUES ($1, $2, 0.5, 'llm', true)`,
      [item, produto],
    );
  });

  afterAll(async () => {
    await app.close();
    await limpar();
    await db.end();
  });

  it('sem token, com token adulterado ou vencido a api recusa', async () => {
    const http = request(app.getHttpServer());
    await http.get('/receipts').expect(401);
    const token = assinarToken(OUTRO, process.env.API_TOKEN_SECRET!);
    await http
      .get('/receipts')
      .set('Authorization', `Bearer ${token.slice(0, -2)}xx`)
      .expect(401);
    const deOutraChave = assinarToken(OUTRO, 'outra-chave');
    await http
      .get('/receipts')
      .set('Authorization', `Bearer ${deOutraChave}`)
      .expect(401);
    const vencido = assinarToken(OUTRO, process.env.API_TOKEN_SECRET!, -1);
    await http
      .get('/receipts')
      .set('Authorization', `Bearer ${vencido}`)
      .expect(401);
    await http.get('/health').expect(200);
  });

  it('o dono vê o cupom; o outro usuário não acha nada', async () => {
    const lista = await dono().get('/receipts').expect(200);
    expect(lista.body.map((c: { id: number }) => c.id)).toContain(cupom);

    const doOutro = await outro().get('/receipts').expect(200);
    expect(doOutro.body.map((c: { id: number }) => c.id)).not.toContain(cupom);
    await outro().get(`/receipts/${cupom}`).expect(404);
    await outro()
      .patch(`/receipts/${cupom}`)
      .send({
        mercado: 'INVADIDO',
        emitido_em: '2026-10-26T12:00:00-03:00',
        total: '1.00',
        desconto: '0',
        acrescimo: '0',
        pagamento: '',
      })
      .expect(404);
    await outro()
      .patch(`/receipts/${cupom}/items/${item}`)
      .send({
        codigo: '',
        descricao_original: 'INVADIDO',
        quantidade: '1',
        unidade: 'UN',
        valor_unitario: '1',
        valor_total: '1',
      })
      .expect(404);
    await outro().post(`/receipts/${cupom}/confirm`).expect(404);
    await outro().post(`/receipts/${cupom}/normalize`).expect(404);
  });

  it('revisão, correção, preços e previsão também ficam por usuário', async () => {
    const fila = await outro().get('/review-queue').expect(200);
    expect(
      fila.body.map((i: { item_id: number }) => i.item_id),
    ).not.toContain(item);
    const correcao = {
      produto: 'invadido',
      marca: '',
      conteudo: 1,
      unidade_padrao: 'l',
      categoria: 'Leite',
    };
    await outro()
      .post(`/review-queue/${item}/resolve`)
      .send(correcao)
      .expect(404);
    await outro()
      .post(`/receipts/items/${item}/normalization`)
      .send(correcao)
      .expect(404);
    await outro().get(`/products/${produto}/prices`).expect(404);
    await outro().get(`/products/${produto}/forecast`).expect(404);

    const resumo = await outro()
      .get('/dashboard/summary')
      .query({ from: '2000-01-01', to: '2100-01-01' })
      .expect(200);
    expect(
      resumo.body.opcoes.mercados.map((m: { nome: string }) => m.nome),
    ).not.toContain('LOJA DO DONO');

    const { rows } = await db.query(
      'SELECT nome FROM stores WHERE cnpj = $1',
      [CNPJ],
    );
    expect(rows).toEqual([{ nome: 'LOJA DO DONO' }]);
  });

  it('as views do agente só mostram o usuário declarado na transação', async () => {
    await dono()
      .post(`/review-queue/${item}/resolve`)
      .send({
        produto: `${MARCADOR} leite`,
        marca: '',
        conteudo: 1,
        unidade_padrao: 'l',
        categoria: 'Leite',
      })
      .expect(200);

    const { rows: outroUsuario } = await db.query<{ id: number }>(
      'SELECT id FROM users WHERE google_id = $1',
      [OUTRO.sub],
    );
    const nasViews = async (usuario: string | null) => {
      await db.query('BEGIN');
      if (usuario !== null)
        await db.query(`SELECT set_config('app.user_id', $1, true)`, [
          usuario,
        ]);
      const { rows } = await db.query(
        'SELECT 1 FROM v_compras WHERE produto = $1',
        [`${MARCADOR} leite`],
      );
      await db.query('COMMIT');
      return rows.length;
    };
    expect(await nasViews(String(DONO))).toBe(1);
    expect(await nasViews(String(outroUsuario[0].id))).toBe(0);
    expect(await nasViews(null)).toBe(0);
  });

  it('preferência de IA é do usuário', async () => {
    await outro().patch('/me').send({ usar_ia: false }).expect(200);
    expect((await outro().get('/me').expect(200)).body.usar_ia).toBe(false);
    expect((await dono().get('/me').expect(200)).body).toMatchObject({
      id: DONO,
      email: 'dono@teste.local',
    });
    await outro().patch('/me').send({ usar_ia: 'sim' }).expect(400);
  });
});
