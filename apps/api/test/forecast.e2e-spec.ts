import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { comLogin } from './login.js';

const CNPJ = '00000000000787';
const PREFIXO = '34';
const MARCADOR = 'teste previsao';

interface SerieEnviada {
  id: string;
  pontos: { mes: string; valor: number }[];
}

describe('previsão de preço (RF08)', () => {
  let app: INestApplication<App>;
  let db: pg.Client;
  let enviadas: SerieEnviada[] = [];
  let sequencia = 0;
  const ids: Record<string, number> = {};

  const servidor = () => comLogin(app);

  const limpar = async () => {
    await db.query('DELETE FROM forecasts');
    await db.query('DELETE FROM receipts WHERE chave_acesso LIKE $1', [
      `${PREFIXO}%`,
    ]);
    await db.query('DELETE FROM stores WHERE cnpj = $1', [CNPJ]);
    await db.query('DELETE FROM products WHERE nome_canonico LIKE $1', [
      `${MARCADOR}%`,
    ]);
  };

  const produto = async (nome: string, conteudo: number, categoria: string) => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO products (user_id, nome_canonico, conteudo, unidade_padrao, category_id)
       SELECT 1, $1, $2, 'kg', id FROM categories WHERE nome = $3 RETURNING id`,
      [`${MARCADOR} ${nome}`, conteudo, categoria],
    );
    ids[nome] = rows[0].id;
  };

  const compra = async (
    nome: string,
    mes: string,
    total: number,
    emRevisao = false,
  ) => {
    sequencia += 1;
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO receipts (user_id, store_id, chave_acesso, emitido_em, total, origem, status)
       SELECT 1, id, $2, $3, $4, 'qr', 'normalizado' FROM stores WHERE cnpj = $1 AND user_id = 1 RETURNING id`,
      [
        CNPJ,
        `${PREFIXO}${String(sequencia).padStart(42, '0')}`,
        `${mes}-15T12:00:00-03:00`,
        total,
      ],
    );
    const { rows: itens } = await db.query<{ id: number }>(
      `INSERT INTO receipt_items (receipt_id, descricao_original, quantidade, unidade, valor_unitario, valor_total)
       VALUES ($1, 'X', 1, 'UN', $2, $2) RETURNING id`,
      [rows[0].id, total],
    );
    await db.query(
      `INSERT INTO item_normalizations (receipt_item_id, product_id, confianca, origem, em_revisao)
       VALUES ($1, $2, 0.9, 'llm', $3)`,
      [itens[0].id, ids[nome], emRevisao],
    );
  };

  beforeAll(async () => {
    process.env.AI_URL = 'http://ai-teste';
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await limpar();
    await db.query(
      `INSERT INTO stores (user_id, cnpj, nome) VALUES (1, $1, 'LOJA PREVISAO')`,
      [CNPJ],
    );
    await produto('queijo longo', 0.5, 'Queijos');
    await produto('queijo curto', 1, 'Queijos');
    await produto('esponja', 1, 'Louça');

    // 7 meses, com R$ 10 por embalagem de 0,5 kg: R$ 20/kg.
    for (const mes of [
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]) {
      await compra('queijo longo', mes, 10);
    }
    await compra('queijo curto', '2026-06', 40);
    await compra('queijo curto', '2026-07', 44);
    await compra('queijo curto', '2026-07', 999, true); // em revisão: fora da série
    await compra('esponja', '2026-07', 3);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        enviadas = (JSON.parse(init.body) as { series: SerieEnviada[] }).series;
        const resposta = Object.fromEntries(
          enviadas.map((s) => {
            if (s.pontos.length < 6) return [s.id, null];
            const ultimo = s.pontos.at(-1)!.valor;
            return [
              s.id,
              {
                modelo: 'ultimo_preco',
                mae_validacao: ultimo * 0.1,
                ultimo,
                previsoes: ['2026-08', '2026-09', '2026-10'].map((mes) => ({
                  mes,
                  previsto: ultimo * 1.1,
                  inferior: ultimo,
                  superior: ultimo * 1.2,
                })),
              },
            ];
          }),
        );
        return Response.json(resposta);
      }),
    );

    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await limpar();
    await app.close();
    await db.end();
  });

  it('envia ao ai o preço por unidade padrão e o índice da categoria', async () => {
    const { body } = await servidor().post('/forecasts/run').expect(200);
    expect(body).toEqual({ produtos: 1, categorias: 1 });

    const longo = enviadas.find((s) => s.id === `p${ids['queijo longo']}`)!;
    expect(longo.pontos).toHaveLength(7);
    expect(longo.pontos.every((p) => p.valor === 20)).toBe(true);
    expect(enviadas.some((s) => s.id === `p${ids['queijo curto']}`)).toBe(
      false,
    ); // menos de 6 meses

    // Queijo curto: 40 e 44 sobre a média 42; o longo fica sempre em 1.
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM categories WHERE nome = 'Queijos'`,
    );
    const indice = enviadas.find((s) => s.id === `c${rows[0].id}`)!;
    const julho = indice.pontos.find((p) => p.mes === '2026-07')!.valor;
    expect(julho).toBeCloseTo((1 + 44 / 42) / 2);
    expect(indice.pontos.find((p) => p.mes === '2026-01')!.valor).toBeCloseTo(
      1,
    );
  });

  it('produto com 6 meses ou mais tem previsão própria com selo', async () => {
    await servidor().post('/forecasts/run').expect(200);
    const { body } = await servidor()
      .get(`/products/${ids['queijo longo']}/forecast`)
      .expect(200);
    expect(body).toMatchObject({
      tipo: 'produto',
      meses_observados: 7,
      modelo: 'ultimo_preco',
      selo: 'media',
    });
    expect(body.erro_pct).toBeCloseTo(0.1);
    expect(body.previsoes.map((p: { mes: string }) => p.mes)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(body.previsoes[0].previsto).toBeCloseTo(22);
  });

  it('produto com poucos meses usa a variação da categoria sobre o próprio preço', async () => {
    await servidor().post('/forecasts/run').expect(200);
    const { body } = await servidor()
      .get(`/products/${ids['queijo curto']}/forecast`)
      .expect(200);
    expect(body).toMatchObject({
      tipo: 'categoria',
      categoria: 'Queijos',
      meses_observados: 2,
    });
    // Último preço do produto (44) vezes a alta prevista da categoria (10%).
    expect(body.previsoes[0].previsto).toBeCloseTo(48.4);
    expect(body.previsoes[0].inferior).toBeCloseTo(44);
    expect(body.erro_pct).toBeCloseTo(0.1);
  });

  it('sem histórico no produto nem na categoria, diz que é insuficiente', async () => {
    await servidor().post('/forecasts/run').expect(200);
    const { body } = await servidor()
      .get(`/products/${ids.esponja}/forecast`)
      .expect(200);
    expect(body).toMatchObject({
      tipo: 'insuficiente',
      meses_observados: 1,
      meses_minimos: 6,
    });
    await servidor().get('/products/999999999/forecast').expect(404);
  });

  it('rodar de novo substitui as previsões em vez de acumular', async () => {
    await servidor().post('/forecasts/run').expect(200);
    await servidor().post('/forecasts/run').expect(200);
    const { rows } = await db.query('SELECT 1 FROM forecasts');
    expect(rows).toHaveLength(6);
  });
});
