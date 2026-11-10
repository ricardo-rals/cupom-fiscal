import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { comLogin, DONO } from './login.js';

const CNPJ = '00000000000717';
const MARCADOR = 'teste gastos';
const OUTRO = { sub: 'teste-outro-gastos', email: 'outro-gastos@teste.local' };

describe('orçamento, previsão de gasto e lista de compras (etapa 5)', () => {
  let app: INestApplication<App>;
  let db: pg.Client;
  let loja: number;
  let chaves = 0;

  const dono = () => comLogin(app);

  const produto = async (nome: string, categoria: string) => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO products (user_id, nome_canonico, conteudo, unidade_padrao, category_id)
       SELECT $1, $2, 1, 'un', id FROM categories WHERE nome = $3 RETURNING id`,
      [DONO, `${MARCADOR} ${nome}`, categoria],
    );
    return rows[0].id;
  };

  /** Compra normalizada de um produto há `dias` dias. */
  const comprar = async (produtoId: number, dias: number, valor = 9) => {
    chaves += 1;
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO receipts (user_id, store_id, chave_acesso, emitido_em, total, origem, status)
       VALUES ($1, $2, $3, now() - make_interval(days => $4), $5, 'qr', 'normalizado')
       RETURNING id`,
      [DONO, loja, `21${String(chaves).padStart(42, '0')}`, dias, valor],
    );
    const { rows: itens } = await db.query<{ id: number }>(
      `INSERT INTO receipt_items
         (receipt_id, descricao_original, quantidade, unidade, valor_unitario, valor_total)
       VALUES ($1, 'X', 1, 'UN', $2, $2) RETURNING id`,
      [rows[0].id, valor],
    );
    await db.query(
      `INSERT INTO item_normalizations (receipt_item_id, product_id, confianca, origem)
       VALUES ($1, $2, 0.9, 'llm')`,
      [itens[0].id, produtoId],
    );
  };

  const limpar = async () => {
    await db.query("DELETE FROM receipts WHERE chave_acesso LIKE '21%'");
    await db.query('DELETE FROM stores WHERE cnpj = $1', [CNPJ]);
    await db.query('DELETE FROM products WHERE nome_canonico LIKE $1', [
      `${MARCADOR}%`,
    ]);
    await db.query('DELETE FROM budgets');
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

    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO stores (user_id, cnpj, nome) VALUES ($1, $2, 'LOJA GASTOS') RETURNING id`,
      [DONO, CNPJ],
    );
    loja = rows[0].id;
    const cafe = await produto('cafe', 'Café e chá');
    for (const dias of [31, 21, 11]) await comprar(cafe, dias, 18);
    await comprar(await produto('panela', 'Diversos'), 5, 80);
    await comprar(await produto('leite', 'Leite'), 0, 9);
  });

  afterAll(async () => {
    await limpar();
    await app.close();
    await db.end();
  });

  it('lista sugere o recorrente perto de acabar e não sugere compra única', async () => {
    const { body } = await dono().get('/shopping-list').expect(200);
    const nomes = body.map((s: { nome: string }) => s.nome);
    expect(nomes).toContain(`${MARCADOR} cafe`);
    expect(nomes).not.toContain(`${MARCADOR} panela`);
    expect(
      body.find((s: { nome: string }) => s.nome === `${MARCADOR} cafe`),
    ).toMatchObject({ intervalo_dias: 10, compras: 3, preco_esperado: 18 });

    const doOutro = await comLogin(app, OUTRO).get('/shopping-list').expect(200);
    expect(doOutro.body).toEqual([]);
  });

  it('orçamento avisa em 80%, estoura em 100% e sai com valor zero', async () => {
    const perto = await dono()
      .put('/budgets')
      .send({ categoria: 'Leite', valor: '10.00' })
      .expect(200);
    expect(perto.body).toContainEqual(
      expect.objectContaining({ categoria: 'Leite', gasto_mes: 9, alerta: 'perto' }),
    );

    const estourou = await dono()
      .put('/budgets')
      .send({ categoria: 'Leite', valor: '5' })
      .expect(200);
    expect(estourou.body[0]).toMatchObject({ categoria: 'Leite', alerta: 'estourou' });

    expect((await comLogin(app, OUTRO).get('/budgets').expect(200)).body).toEqual([]);

    await dono().put('/budgets').send({ categoria: 'Leite', valor: '0' }).expect(200);
    expect((await dono().get('/budgets').expect(200)).body).toEqual([]);
    await dono().put('/budgets').send({ categoria: 'Inventada', valor: '5' }).expect(400);
    await dono().put('/budgets').send({ categoria: 'Leite', valor: '-5' }).expect(400);
  });

  it('previsão do mês usa a média dos 3 meses enquanto não há 6 meses de compras', async () => {
    const { body } = await dono().get('/spending/forecast').expect(200);
    expect(body.total.metodo).toBe('media_3_meses');
    expect(body.total.gasto_ate_agora).toBeGreaterThanOrEqual(9);
    expect(body.categorias.map((c: { categoria: string }) => c.categoria)).toContain(
      'Leite',
    );
    const doOutro = await comLogin(app, OUTRO).get('/spending/forecast').expect(200);
    expect(doOutro.body).toMatchObject({ total: { previsto: 0, gasto_ate_agora: 0 } });
  });
});
