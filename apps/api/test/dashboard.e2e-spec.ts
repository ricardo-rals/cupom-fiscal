import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

const CNPJS = ['00000000000515', '00000000000606'];
const PREFIXO = '33';
const MARCADOR = 'teste dashboard';

describe('dashboard e histórico de preços (RF05, RF06)', () => {
  let app: INestApplication<App>;
  let db: pg.Client;
  let lojas: number[];
  let leite: number;
  let sabao: number;
  let sequencia = 0;

  const resumo = (query: Record<string, string | number>) =>
    request(app.getHttpServer()).get('/dashboard/summary').query(query);

  const limpar = async () => {
    await db.query('DELETE FROM receipts WHERE chave_acesso LIKE $1', [
      `${PREFIXO}%`,
    ]);
    await db.query('DELETE FROM stores WHERE cnpj = ANY($1)', [CNPJS]);
    await db.query('DELETE FROM products WHERE nome_canonico LIKE $1', [
      `${MARCADOR}%`,
    ]);
  };

  const produto = async (nome: string, conteudo: number, categoria: string) => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO products (nome_canonico, conteudo, unidade_padrao, category_id)
       SELECT $1, $2, 'l', id FROM categories WHERE nome = $3 RETURNING id`,
      [`${MARCADOR} ${nome}`, conteudo, categoria],
    );
    return rows[0].id;
  };

  const compra = async (opcoes: {
    loja: number;
    quando: string;
    produto: number;
    quantidade: number;
    total: number;
    status?: string;
    emRevisao?: boolean;
    desconto?: number;
  }) => {
    sequencia += 1;
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO receipts (store_id, chave_acesso, emitido_em, total, origem, status)
       VALUES ($1, $2, $3, $4, 'qr', $5) RETURNING id`,
      [
        opcoes.loja,
        `${PREFIXO}${String(sequencia).padStart(42, '0')}`,
        opcoes.quando,
        opcoes.total,
        opcoes.status ?? 'normalizado',
      ],
    );
    const { rows: itens } = await db.query<{ id: number }>(
      `INSERT INTO receipt_items
         (receipt_id, descricao_original, quantidade, unidade, valor_unitario, valor_total, desconto)
       VALUES ($1, 'X', $2, 'UN', 1, $3, $4) RETURNING id`,
      [rows[0].id, opcoes.quantidade, opcoes.total, opcoes.desconto ?? 0],
    );
    await db.query(
      `INSERT INTO item_normalizations (receipt_item_id, product_id, confianca, origem, em_revisao)
       VALUES ($1, $2, 0.9, 'llm', $3)`,
      [itens[0].id, opcoes.produto, opcoes.emRevisao ?? false],
    );
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
      `INSERT INTO stores (cnpj, nome) VALUES ($1, 'LOJA A'), ($2, 'LOJA B') RETURNING id`,
      CNPJS,
    );
    lojas = rows.map((r) => r.id);
    leite = await produto('leite', 2, 'Leite');
    sabao = await produto('sabao', 1, 'Lavagem de roupa');

    const [a, b] = lojas;
    await compra({
      loja: a,
      quando: '2031-03-10T12:00:00-03:00',
      produto: leite,
      quantidade: 2,
      total: 20,
    });
    await compra({
      loja: b,
      quando: '2031-03-20T12:00:00-03:00',
      produto: leite,
      quantidade: 1,
      total: 13,
      desconto: 1,
    });
    await compra({
      loja: a,
      quando: '2031-03-25T12:00:00-03:00',
      produto: sabao,
      quantidade: 1,
      total: 8,
    });
    // Fim de 31/03 na Bahia já é 01/04 em UTC: precisa contar em março.
    await compra({
      loja: a,
      quando: '2031-03-31T23:30:00-03:00',
      produto: sabao,
      quantidade: 1,
      total: 2,
    });
    // Primeiro minuto de 01/04 na Bahia: fora de março.
    await compra({
      loja: a,
      quando: '2031-04-01T00:00:00-03:00',
      produto: sabao,
      quantidade: 1,
      total: 100,
    });
    // Período anterior de 31 dias, de 29/01 a 28/02.
    await compra({
      loja: a,
      quando: '2031-02-15T12:00:00-03:00',
      produto: leite,
      quantidade: 1,
      total: 30,
    });
    // Não contam.
    await compra({
      loja: a,
      quando: '2031-03-11T12:00:00-03:00',
      produto: leite,
      quantidade: 1,
      total: 500,
      status: 'rascunho',
    });
    await compra({
      loja: a,
      quando: '2031-03-12T12:00:00-03:00',
      produto: leite,
      quantidade: 1,
      total: 500,
      status: 'confirmado',
    });
    await compra({
      loja: a,
      quando: '2031-03-13T12:00:00-03:00',
      produto: leite,
      quantidade: 1,
      total: 500,
      emRevisao: true,
    });
  });

  afterAll(async () => {
    await limpar();
    await app.close();
    await db.end();
  });

  const MARCO = { from: '2031-03-01', to: '2031-03-31' };

  it('soma por período, categoria, mercado e produto, sem rascunho nem item em revisão', async () => {
    const { body } = await resumo(MARCO).expect(200);
    expect(Number(body.total)).toBe(42);
    expect(body.cupons).toBe(4);
    expect(
      body.por_categoria.map((c: { nome: string; total: string }) => [
        c.nome,
        Number(c.total),
      ]),
    ).toEqual([
      ['Leite', 32],
      ['Lavagem de roupa', 10],
    ]);
    expect(
      body.por_mercado.map((m: { nome: string; total: string }) => [
        m.nome,
        Number(m.total),
      ]),
    ).toEqual([
      ['LOJA A', 30],
      ['LOJA B', 12],
    ]);
    expect(body.por_produto[0]).toMatchObject({
      id: leite,
      nome: `${MARCADOR} leite`,
    });
    expect(body.opcoes.categorias).toHaveLength(43);
    expect(body.opcoes.mercados.map((m: { id: number }) => m.id)).toEqual(
      expect.arrayContaining(lojas),
    );
  });

  it('compara com o período anterior de mesma duração', async () => {
    const { body } = await resumo(MARCO).expect(200);
    expect(body.anterior).toMatchObject({
      from: '2031-01-29',
      to: '2031-02-28',
    });
    expect(Number(body.anterior.total)).toBe(30);
    expect(Number(body.anterior.variacao_pct)).toBe(40);
  });

  it('sem compras no período anterior não inventa variação', async () => {
    const { body } = await resumo({
      from: '2031-01-01',
      to: '2031-02-28',
    }).expect(200);
    expect(Number(body.total)).toBe(30);
    expect(body.anterior.variacao_pct).toBeNull();
  });

  it('filtra por categoria e por mercado, também no período anterior', async () => {
    const porCategoria = await resumo({
      ...MARCO,
      category: 'Lavagem de roupa',
    }).expect(200);
    expect(Number(porCategoria.body.total)).toBe(10);
    expect(Number(porCategoria.body.anterior.total)).toBe(0);

    const porMercado = await resumo({ ...MARCO, store: lojas[1] }).expect(200);
    expect(Number(porMercado.body.total)).toBe(12);
    expect(Number(porMercado.body.anterior.total)).toBe(0);
  });

  it.each([
    [{ to: '2031-03-31' }],
    [{ from: '2031-03-01' }],
    [{ from: 'ontem', to: '2031-03-31' }],
    [{ from: '2031-13-01', to: '2031-13-02' }],
    [{ from: '2031-03-31', to: '2031-03-01' }],
    [{ ...MARCO, store: 'abc' }],
  ])('recusa filtro inválido %j', async (query) => {
    await resumo(query).expect(400);
  });

  it('a série indica mercado e data, e calcula os dois preços', async () => {
    const { body } = await request(app.getHttpServer())
      .get(`/products/${leite}/prices`)
      .expect(200);
    expect(body).toMatchObject({
      produto: `${MARCADOR} leite`,
      unidade_padrao: 'l',
      categoria: 'Leite',
    });
    expect(body.pontos).toHaveLength(3);
    expect(
      body.pontos.map(
        (p: {
          mercado: string;
          preco_unitario: string;
          preco_padrao: string;
        }) => [p.mercado, Number(p.preco_unitario), Number(p.preco_padrao)],
      ),
    ).toEqual([
      ['LOJA A', 30, 15],
      ['LOJA A', 10, 5],
      ['LOJA B', 12, 6],
    ]);
    expect(new Date(body.pontos[0].emitido_em).toISOString()).toBe(
      '2031-02-15T15:00:00.000Z',
    );

    await request(app.getHttpServer())
      .get('/products/999999999/prices')
      .expect(404);
  });
});
