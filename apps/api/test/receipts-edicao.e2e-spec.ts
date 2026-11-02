import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

const CNPJ = '00000000000434';
const CHAVE = '24'.padEnd(44, '0');
const MARCADOR = 'teste edicao';
const DESCRICAO = 'TESTE-EDICAO LEITE';

const correcao = {
  produto: `${MARCADOR} leite`,
  marca: '',
  conteudo: 1,
  unidade_padrao: 'l',
  categoria: 'Leite',
};

const cupomValido = {
  mercado: 'LOJA EDITADA',
  emitido_em: '2026-10-26T12:00:00-03:00',
  total: '12.50',
  desconto: '1.00',
  acrescimo: '0',
  pagamento: 'Pix',
};

const itemValido = {
  codigo: '7',
  descricao_original: DESCRICAO,
  quantidade: '2.5',
  unidade: 'KG',
  valor_unitario: '5.0000',
  valor_total: '12.50',
};

describe('edição de cupom e itens (RF03)', () => {
  let app: INestApplication<App>;
  let db: pg.Client;
  let cupomId: number;
  let itemId: number;

  const servidor = () => request(app.getHttpServer());

  const limpar = async () => {
    await db.query('DELETE FROM user_labels WHERE descricao_original LIKE $1', [
      'TESTE-EDICAO%',
    ]);
    await db.query('DELETE FROM receipts WHERE chave_acesso = $1', [CHAVE]);
    await db.query('DELETE FROM stores WHERE cnpj = $1', [CNPJ]);
    await db.query('DELETE FROM products WHERE nome_canonico LIKE $1', [
      `${MARCADOR}%`,
    ]);
  };

  const normalizarItem = () =>
    db.query(
      `INSERT INTO item_normalizations (receipt_item_id, confianca, origem, em_revisao)
       VALUES ($1, 0.5, 'llm', false)`,
      [itemId],
    );

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await limpar();
    const { rows: lojas } = await db.query<{ id: number }>(
      `INSERT INTO stores (cnpj, nome) VALUES ($1, 'LOJA') RETURNING id`,
      [CNPJ],
    );
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO receipts (store_id, chave_acesso, emitido_em, total, origem, status)
       VALUES ($1, $2, now(), 5, 'qr', 'normalizado') RETURNING id`,
      [lojas[0].id, CHAVE],
    );
    cupomId = rows[0].id;
    const { rows: itens } = await db.query<{ id: number }>(
      `INSERT INTO receipt_items
         (receipt_id, descricao_original, quantidade, unidade, valor_unitario, valor_total)
       VALUES ($1, $2, 1, 'UN', 5, 5) RETURNING id`,
      [cupomId, DESCRICAO],
    );
    itemId = itens[0].id;
  });

  afterAll(async () => {
    await limpar();
    await app.close();
    await db.end();
  });

  it('lista o cupom e mostra o detalhe sem job parado depois de normalizado', async () => {
    const lista = await servidor().get('/receipts').expect(200);
    expect(
      (lista.body as { id: number }[]).find((c) => c.id === cupomId),
    ).toMatchObject({ mercado: 'LOJA', itens: 1, em_revisao: 0 });

    const detalhe = await servidor().get(`/receipts/${cupomId}`).expect(200);
    expect(detalhe.body).toMatchObject({ cnpj: CNPJ, parada: false, itens: 1 });
    expect(detalhe.body.lista[0]).toMatchObject({
      id: itemId,
      descricao_original: DESCRICAO,
    });
  });

  it('edita os campos do cupom, depois de confirmado', async () => {
    const { body } = await servidor()
      .patch(`/receipts/${cupomId}`)
      .send(cupomValido)
      .expect(200);
    expect(body).toMatchObject({
      mercado: 'LOJA EDITADA',
      total: '12.5',
      desconto: '1',
      pagamento: 'Pix',
      status: 'normalizado',
    });
    await servidor().patch('/receipts/999999999').send(cupomValido).expect(404);
  });

  it('editar valores do item mantém a normalização', async () => {
    await normalizarItem();
    const { body } = await servidor()
      .patch(`/receipts/${cupomId}/items/${itemId}`)
      .send(itemValido)
      .expect(200);
    expect(body.status).toBe('normalizado');
    expect(body.lista[0]).toMatchObject({ quantidade: '2.5', origem: 'llm' });
  });

  it('nova descrição apaga a normalização e devolve o cupom para a fila', async () => {
    await normalizarItem();
    const { body } = await servidor()
      .patch(`/receipts/${cupomId}/items/${itemId}`)
      .send({ ...itemValido, descricao_original: 'TESTE-EDICAO REQUEIJAO' })
      .expect(200);
    expect(body).toMatchObject({ status: 'confirmado', parada: false });
    expect(body.lista[0].origem).toBeNull();
  });

  it('cupom parado aparece como parado e pode ser retomado uma vez', async () => {
    await db.query(`UPDATE receipts SET status = 'confirmado' WHERE id = $1`, [
      cupomId,
    ]);
    const contarJobs = async () =>
      (
        await db.query(
          `SELECT 1 FROM pgboss.job WHERE name = 'normalizacao' AND data->>'receiptId' = $1`,
          [String(cupomId)],
        )
      ).rowCount;

    const parado = await servidor().get(`/receipts/${cupomId}`).expect(200);
    expect(parado.body.parada).toBe(true);

    await servidor().post(`/receipts/${cupomId}/normalize`).expect(200);
    await servidor().post(`/receipts/${cupomId}/normalize`).expect(200);
    expect(await contarJobs()).toBe(1);
    const retomado = await servidor().get(`/receipts/${cupomId}`).expect(200);
    expect(retomado.body.parada).toBe(false);
  });

  it('corrige a normalização de item fora da fila e grava o rótulo', async () => {
    await servidor()
      .post(`/receipts/items/${itemId}/normalization`)
      .send(correcao)
      .expect(404);
    await normalizarItem();
    await servidor()
      .post(`/receipts/items/${itemId}/normalization`)
      .send(correcao)
      .expect(200);

    const { body } = await servidor().get(`/receipts/${cupomId}`).expect(200);
    expect(body.lista[0]).toMatchObject({
      origem: 'usuario',
      normalizacao: { produto: `${MARCADOR} leite`, categoria: 'Leite' },
    });
    const { rowCount } = await db.query(
      'SELECT 1 FROM user_labels WHERE descricao_original = $1',
      [DESCRICAO],
    );
    expect(rowCount).toBe(1);
  });

  it('lista só categorias, sem os grupos', async () => {
    const { body } = await servidor()
      .get('/review-queue/categories')
      .expect(200);
    expect(body).toContain('Leite');
    expect(body).not.toContain('Mercearia');
    expect(body).toHaveLength(43);
  });

  it.each([
    ['total negativo', { total: '-1' }],
    ['total com vírgula', { total: '1,50' }],
    ['total grande demais', { total: '99999999999' }],
    ['data inválida', { emitido_em: 'ontem' }],
    ['mercado vazio', { mercado: '  ' }],
    ['CPF no pagamento', { pagamento: 'cpf 000.000.000-00' }],
  ])('recusa cupom com %s', async (_, campo) => {
    await servidor()
      .patch(`/receipts/${cupomId}`)
      .send({ ...cupomValido, ...campo })
      .expect(400);
  });

  it.each([
    ['quantidade zero', { quantidade: '0' }],
    ['quantidade numérica', { quantidade: 1 }],
    ['descrição vazia', { descricao_original: ' ' }],
    ['CPF na descrição', { descricao_original: '000.000.000-00' }],
    ['código ausente', { codigo: undefined }],
  ])('recusa item com %s', async (_, campo) => {
    await servidor()
      .patch(`/receipts/${cupomId}/items/${itemId}`)
      .send({ ...itemValido, ...campo })
      .expect(400);
  });

  it('não edita item de outro cupom', async () => {
    await servidor()
      .patch(`/receipts/999999999/items/${itemId}`)
      .send(itemValido)
      .expect(404);
  });
});
