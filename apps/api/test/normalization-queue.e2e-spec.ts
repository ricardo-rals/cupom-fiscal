import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { comLogin } from './login.js';

const CNPJ = '00000000000353';
const PREFIXO = 'TESTE-FILA';
const MARCADOR = 'teste fila';
const CHAVE_QR = '27'.padEnd(44, '0');
const CHAVE_RECUPERADA = '26'.padEnd(44, '0');
const CHAVE_RASCUNHO = '25'.padEnd(44, '0');
const CHAVES = [CHAVE_QR, CHAVE_RECUPERADA, CHAVE_RASCUNHO];

const itemCupom = (descricao: string) => ({
  codigo: '1',
  descricao_original: descricao,
  quantidade: '1',
  unidade: 'UN',
  valor_unitario: '5',
  valor_total: '5',
});

const cupom = {
  cnpj: CNPJ,
  nome: 'LOJA FILA',
  cidade: null,
  emitido_em: '2026-10-26T12:00:00-03:00',
  chave_acesso: CHAVE_QR,
  itens: [itemCupom(`${PREFIXO} CERTO`), itemCupom(`${PREFIXO} DUVIDA`)],
  total: '10',
  desconto: '0',
  acrescimo: '0',
  pagamento: null,
};

interface ItemIa {
  id: number;
  descricao: string;
}

describe('fila de normalização e revisão', () => {
  let app: INestApplication<App>;
  let db: pg.Client;
  let falhasRestantes = 0;

  const servidor = () => comLogin(app);

  const stubIa = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        if (url.endsWith('/nfce/parse')) return Response.json(cupom);
        if (falhasRestantes > 0) {
          falhasRestantes -= 1;
          return Response.json({}, { status: 502 });
        }
        const { itens } = JSON.parse(init.body) as { itens: ItemIa[] };
        return Response.json({
          itens: itens.map((i) => ({
            id: i.id,
            produto: `${MARCADOR} ${i.descricao.includes('DUVIDA') ? 'palpite' : 'leite'}`,
            marca: '',
            conteudo: 1,
            unidade_padrao: 'l',
            categoria: 'Leite',
            confianca: i.descricao.includes('DUVIDA') ? 0.3 : 0.95,
          })),
          chamada: {
            modelo: 'teste-fila',
            tokens_in: 1,
            tokens_out: 1,
            custo: '0.000001',
            latencia_ms: 1,
          },
          prompt_version: 'v1',
        });
      }),
    );

  const statusDe = async (chave: string) => {
    const { rows } = await db.query<{ status: string }>(
      'SELECT status FROM receipts WHERE chave_acesso = $1',
      [chave],
    );
    return rows[0]?.status;
  };
  const aguardarNormalizado = (chave: string) =>
    vi.waitFor(async () => expect(await statusDe(chave)).toBe('normalizado'), {
      timeout: 30_000,
      interval: 200,
    });

  const inserirCupom = async (chave: string, status: string, descricao: string) => {
    const { rows: lojas } = await db.query<{ id: number }>(
      `INSERT INTO stores (user_id, cnpj, nome) VALUES (1, $1, 'LOJA FILA')
       ON CONFLICT (user_id, cnpj) DO UPDATE SET nome = 'LOJA FILA' RETURNING id`,
      [CNPJ],
    );
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO receipts (user_id, store_id, chave_acesso, emitido_em, total, origem, status)
       VALUES (1, $1, $2, now(), 5, 'foto', $3) RETURNING id`,
      [lojas[0].id, chave, status],
    );
    await db.query(
      `INSERT INTO receipt_items
         (receipt_id, descricao_original, quantidade, unidade, valor_unitario, valor_total)
       VALUES ($1, $2, 1, 'UN', 5, 5)`,
      [rows[0].id, descricao],
    );
    return rows[0].id;
  };

  const limpar = async () => {
    await db.query('DELETE FROM user_labels WHERE descricao_original LIKE $1', [`${PREFIXO}%`]);
    await db.query('DELETE FROM normalization_cache WHERE cnpj = $1', [CNPJ]);
    await db.query('DELETE FROM receipts WHERE chave_acesso = ANY($1)', [CHAVES]);
    await db.query('DELETE FROM stores WHERE cnpj = $1', [CNPJ]);
    await db.query('DELETE FROM products WHERE nome_canonico LIKE $1', [`${MARCADOR}%`]);
    await db.query(`DELETE FROM llm_calls WHERE modelo = 'teste-fila'`);
  };

  const subirApp = async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    await app.init();
  };

  beforeAll(async () => {
    process.env.NORMALIZACAO_WORKER = 'on';
    process.env.NORMALIZACAO_RETRY_DELAY_S = '1';
    process.env.AI_URL = 'http://ai-teste';
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    // As views só mostram o usuário declarado na sessão, como o agente faz.
    await db.query("SELECT set_config('app.user_id', '1', false)");
    await limpar();
    stubIa();
  });

  beforeEach(() => {
    falhasRestantes = 0;
  });

  afterEach(async () => {
    await app?.close();
    await limpar();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.end();
  });

  it('importar normaliza em segundo plano, e a revisão vira rótulo reutilizável', async () => {
    await subirApp();
    const importacao = await servidor()
      .post('/receipts/qr')
      .send({ url: 'http://x/y' })
      .expect(201);
    expect(importacao.body.status).toBe('confirmado');
    await aguardarNormalizado(CHAVE_QR);

    const situacao = await servidor().get(`/receipts/${importacao.body.id}`).expect(200);
    expect(situacao.body).toMatchObject({ status: 'normalizado', itens: 2, em_revisao: 1 });

    const fila = await servidor().get('/review-queue').expect(200);
    const pendente = (fila.body as { descricao_original: string; item_id: number }[]).find(
      (i) => i.descricao_original === `${PREFIXO} DUVIDA`,
    );
    expect(pendente).toMatchObject({
      mercado: 'LOJA FILA',
      sugestao: { produto: `${MARCADOR} palpite`, categoria: 'Leite' },
    });

    const correcao = {
      produto: `${MARCADOR} Requeijão`,
      marca: 'Dá Boa',
      conteudo: 0.4,
      unidade_padrao: 'kg',
      categoria: 'Manteiga, requeijão e creme de leite',
    };
    const resolvido = await servidor()
      .post(`/review-queue/${pendente!.item_id}/resolve`)
      .send(correcao)
      .expect(200);
    expect(resolvido.body.itens_resolvidos).toBe(1);

    const { rows: rotulos } = await db.query(
      `SELECT p.nome_canonico, p.marca, c.nome AS categoria
       FROM user_labels u JOIN products p ON p.id = u.product_id JOIN categories c ON c.id = u.category_id
       WHERE u.descricao_original = $1`,
      [`${PREFIXO} DUVIDA`],
    );
    expect(rotulos).toEqual([
      {
        nome_canonico: `${MARCADOR} requeijao`,
        marca: 'da boa',
        categoria: 'Manteiga, requeijão e creme de leite',
      },
    ]);

    const depois = await servidor().get(`/receipts/${importacao.body.id}`).expect(200);
    expect(depois.body.em_revisao).toBe(0);
    await servidor()
      .post(`/review-queue/${pendente!.item_id}/resolve`)
      .send(correcao)
      .expect(404);

    const { rows: nasViews } = await db.query('SELECT 1 FROM v_compras WHERE produto = $1', [
      `${MARCADOR} requeijao`,
    ]);
    expect(nasViews).toHaveLength(1);
  });

  it('corrigir um item resolve os iguais na fila', async () => {
    await inserirCupom(CHAVE_QR, 'confirmado', `${PREFIXO} DUVIDA REPETIDA`);
    await inserirCupom(CHAVE_RECUPERADA, 'confirmado', `${PREFIXO} DUVIDA REPETIDA`);
    await subirApp();
    await aguardarNormalizado(CHAVE_QR);
    await aguardarNormalizado(CHAVE_RECUPERADA);

    const fila = await servidor().get('/review-queue').expect(200);
    const { item_id: itemId } = (
      fila.body as { descricao_original: string; item_id: number }[]
    ).find((i) => i.descricao_original === `${PREFIXO} DUVIDA REPETIDA`)!;

    const { body } = await servidor()
      .post(`/review-queue/${itemId}/resolve`)
      .send({
        produto: `${MARCADOR} x`,
        marca: '',
        conteudo: 1,
        unidade_padrao: 'un',
        categoria: 'Diversos',
      })
      .expect(200);
    expect(body.itens_resolvidos).toBe(2);
  });

  it('cupom parado em confirmado volta para a fila quando a api sobe', async () => {
    await inserirCupom(CHAVE_RECUPERADA, 'confirmado', `${PREFIXO} PARADO`);
    await subirApp();
    await aguardarNormalizado(CHAVE_RECUPERADA);
  });

  it('LLM fora do ar: o job tenta de novo sozinho, com limite', async () => {
    falhasRestantes = 1;
    await inserirCupom(CHAVE_RECUPERADA, 'confirmado', `${PREFIXO} INSTAVEL`);
    await subirApp();
    await aguardarNormalizado(CHAVE_RECUPERADA);
    expect(falhasRestantes).toBe(0);

    const { rows } = await db.query<{ retry_limit: number; retry_backoff: boolean }>(
      `SELECT retry_limit, retry_backoff FROM pgboss.job
       WHERE name = 'normalizacao' ORDER BY created_on DESC LIMIT 1`,
    );
    expect(rows[0]).toEqual({ retry_limit: 5, retry_backoff: true });
  });

  it('confirmar um rascunho dispara a normalização', async () => {
    const id = await inserirCupom(CHAVE_RASCUNHO, 'rascunho', `${PREFIXO} FOTO`);
    await subirApp();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await statusDe(CHAVE_RASCUNHO)).toBe('rascunho');

    await servidor().post(`/receipts/${id}/confirm`).expect(200);
    await aguardarNormalizado(CHAVE_RASCUNHO);

    await servidor().post(`/receipts/${id}/confirm`).expect(200); // repetir não dá erro
    await servidor().post('/receipts/999999999/confirm').expect(404);
    await servidor().get('/receipts/999999999').expect(404);
  });

  it('não aceita resolução inválida', async () => {
    await inserirCupom(CHAVE_RECUPERADA, 'confirmado', `${PREFIXO} DUVIDA INVALIDA`);
    await subirApp();
    await aguardarNormalizado(CHAVE_RECUPERADA);
    const fila = await servidor().get('/review-queue').expect(200);
    const { item_id: itemId } = (
      fila.body as { descricao_original: string; item_id: number }[]
    ).find((i) => i.descricao_original === `${PREFIXO} DUVIDA INVALIDA`)!;

    const valida = {
      produto: `${MARCADOR} y`,
      marca: '',
      conteudo: 1,
      unidade_padrao: 'un',
      categoria: 'Diversos',
    };
    const enviar = (corpo: object) =>
      servidor().post(`/review-queue/${itemId}/resolve`).send(corpo);

    await enviar({ ...valida, produto: '  ' }).expect(400);
    await enviar({ ...valida, conteudo: 0 }).expect(400);
    await enviar({ ...valida, conteudo: '1' }).expect(400);
    await enviar({ ...valida, unidade_padrao: 'g' }).expect(400);
    await enviar({ ...valida, categoria: 'Inventada' }).expect(400);
    await enviar({ ...valida, categoria: 'Mercearia' }).expect(400); // grupo, não categoria
    await enviar({}).expect(400);
    await servidor().post('/review-queue/abc/resolve').send(valida).expect(400);
  });
});
