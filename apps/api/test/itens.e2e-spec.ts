import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { comLogin } from './login.js';

const MERCADO = 'FEIRA TESTE ITENS';
const OUTRO = { sub: 'teste-outro-itens', email: 'outro-itens@teste.local' };

const compra = {
  mercado: MERCADO,
  emitido_em: '2026-11-08T09:30:00-03:00',
  itens: [
    { descricao_original: 'Tomate', quantidade: '500', unidade: 'g', valor_total: '4.50' },
    { descricao_original: 'Cheiro verde', quantidade: '1', unidade: 'un', valor_total: '2.00' },
  ],
};

describe('compra sem nota e itens editáveis (etapa 3)', () => {
  let app: INestApplication<App>;
  let db: pg.Client;

  const dono = () => comLogin(app);
  const total = async (id: number) => {
    const { rows } = await db.query<{ total: string }>(
      'SELECT total::text FROM receipts WHERE id = $1',
      [id],
    );
    return rows[0]?.total;
  };
  const limpar = async () => {
    await db.query(
      'DELETE FROM receipts WHERE store_id IN (SELECT id FROM stores WHERE nome = $1)',
      [MERCADO],
    );
    await db.query('DELETE FROM stores WHERE nome = $1', [MERCADO]);
  };

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await limpar();
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await limpar();
    await app.close();
    await db.end();
  });

  it('lança a compra sem nota, convertendo grama para kg', async () => {
    const { body } = await dono().post('/receipts/manual').send(compra).expect(201);
    expect(body).toMatchObject({
      origem: 'manual',
      status: 'confirmado',
      mercado: MERCADO,
      cnpj: null,
      chave_acesso: null,
      itens: 2,
    });
    expect(Number(body.total)).toBe(6.5);
    const tomate = body.lista.find(
      (i: { descricao_original: string }) => i.descricao_original === 'Tomate',
    );
    expect(tomate).toMatchObject({ unidade: 'KG' });
    expect(Number(tomate.quantidade)).toBe(0.5);
    expect(Number(tomate.valor_unitario)).toBe(9);

    // A segunda compra no mesmo lugar reaproveita o mercado.
    await dono().post('/receipts/manual').send(compra).expect(201);
    const { rows } = await db.query('SELECT 1 FROM stores WHERE nome = $1', [MERCADO]);
    expect(rows).toHaveLength(1);
  });

  it.each([
    [{ ...compra, itens: [] }],
    [{ ...compra, emitido_em: 'ontem' }],
    [{ ...compra, itens: [{ ...compra.itens[0], unidade: 'saco' }] }],
    [{ ...compra, itens: [{ ...compra.itens[0], quantidade: '0' }] }],
    [{ ...compra, itens: [{ ...compra.itens[0], quantidade: '0.01', unidade: 'g', valor_total: '9999999999' }] }],
    [{ ...compra, itens: [{ ...compra.itens[0], descricao_original: 'CPF 123.456.789-09' }] }],
    [{ ...compra, usar_ia: 'talvez' }],
  ])('recusa compra inválida', async (corpo) => {
    await dono().post('/receipts/manual').send(corpo).expect(400);
  });

  it('incluir, editar e excluir item acompanham o total', async () => {
    const { body } = await dono().post('/receipts/manual').send(compra).expect(201);
    const id = body.id as number;

    const incluido = await dono()
      .post(`/receipts/${id}/items`)
      .send({ descricao_original: 'Leite', quantidade: '2', unidade: 'l', valor_total: '10.00' })
      .expect(201);
    expect(incluido.body.itens).toBe(3);
    expect(await total(id)).toBe('16.50');

    const leite = incluido.body.lista.find(
      (i: { descricao_original: string }) => i.descricao_original === 'Leite',
    );
    await dono()
      .patch(`/receipts/${id}/items/${leite.id}`)
      .send({
        codigo: '',
        descricao_original: 'Leite',
        quantidade: '2',
        unidade: 'L',
        valor_unitario: '4',
        valor_total: '8.00',
      })
      .expect(200);
    expect(await total(id)).toBe('14.50');

    const depois = await dono().delete(`/receipts/${id}/items/${leite.id}`).expect(200);
    expect(depois.body.itens).toBe(2);
    expect(await total(id)).toBe('6.50');
    await dono().delete(`/receipts/${id}/items/${leite.id}`).expect(404);
  });

  it('outro usuário não inclui, não exclui item nem cupom', async () => {
    const { body } = await dono().post('/receipts/manual').send(compra).expect(201);
    const outro = comLogin(app, OUTRO);
    await outro
      .post(`/receipts/${body.id}/items`)
      .send(compra.itens[0])
      .expect(404);
    await comLogin(app, OUTRO).delete(`/receipts/${body.id}/items/${body.lista[0].id}`).expect(404);
    await comLogin(app, OUTRO).delete(`/receipts/${body.id}`).expect(404);
    expect(await total(body.id)).toBe('6.50');
  });

  it('excluir o cupom leva os itens junto', async () => {
    const { body } = await dono().post('/receipts/manual').send(compra).expect(201);
    await dono().delete(`/receipts/${body.id}`).expect(204);
    await dono().get(`/receipts/${body.id}`).expect(404);
    const { rows } = await db.query('SELECT 1 FROM receipt_items WHERE receipt_id = $1', [
      body.id,
    ]);
    expect(rows).toHaveLength(0);
  });
});
