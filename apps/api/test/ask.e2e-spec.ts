import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

const MODELO = 'teste-agente';
const SENHA = 'senha-agente-teste';

describe('agente de perguntas (RF09)', () => {
  let app: INestApplication<App>;
  let db: pg.Client;
  let respostaAi: Response;
  let enviado: unknown;

  const perguntar = (corpo: object) =>
    request(app.getHttpServer()).post('/ask').send(corpo);

  const chamada = {
    modelo: MODELO,
    tokens_in: 100,
    tokens_out: 20,
    custo: '0.000150',
    latencia_ms: 9,
  };

  beforeAll(async () => {
    process.env.AI_URL = 'http://ai-teste';
    process.env.AGENT_RO_PASSWORD = SENHA;
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        enviado = JSON.parse(init.body);
        return respostaAi.clone();
      }),
    );
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  afterEach(() =>
    db.query('DELETE FROM llm_calls WHERE modelo = $1', [MODELO]),
  );

  afterAll(async () => {
    delete process.env.AGENT_RO_PASSWORD;
    vi.unstubAllGlobals();
    await app.close();
    await db.end();
  });

  it('devolve resposta, consulta e tabela, e registra o custo de cada chamada', async () => {
    respostaAi = Response.json({
      resposta: 'Você gastou R$ 32,00 com Leite.',
      recusa: null,
      sql: 'SELECT 1 LIMIT 500',
      colunas: ['categoria', 'total'],
      linhas: [['Leite', 32]],
      chamadas: [chamada, chamada],
      prompt_version: 'v1',
    });
    const { body } = await perguntar({
      pergunta: '  Com o que gastei mais?  ',
    }).expect(200);
    expect(body).toMatchObject({
      resposta: 'Você gastou R$ 32,00 com Leite.',
      sql: 'SELECT 1 LIMIT 500',
    });
    expect(body.chamadas).toBeUndefined();
    expect(enviado).toEqual({ pergunta: 'Com o que gastei mais?' });

    const { rows } = await db.query(
      `SELECT finalidade, tokens_in FROM llm_calls WHERE modelo = $1`,
      [MODELO],
    );
    expect(rows).toEqual([
      { finalidade: 'agente', tokens_in: 100 },
      { finalidade: 'agente', tokens_in: 100 },
    ]);
  });

  it('a senha do ambiente habilita o login do agent_ro, que só lê as views', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.username = 'agent_ro';
    url.password = SENHA;
    const agente = new pg.Client({ connectionString: url.toString() });
    await agente.connect();
    await expect(
      agente.query('SELECT 1 FROM v_compras LIMIT 1'),
    ).resolves.toBeDefined();
    await expect(agente.query('SELECT 1 FROM receipts')).rejects.toThrow(
      /permission denied/,
    );
    await agente.end();
  });

  it.each([
    [{}],
    [{ pergunta: '   ' }],
    [{ pergunta: 'x'.repeat(501) }],
    [{ pergunta: 1 }],
  ])('recusa pergunta inválida %j sem chamar o ai', async (corpo) => {
    enviado = undefined;
    await perguntar(corpo).expect(400);
    expect(enviado).toBeUndefined();
  });

  it('com o limite de gasto do mês atingido, não chama o LLM', async () => {
    await db.query(
      `INSERT INTO llm_calls (finalidade, modelo, tokens_in, tokens_out, custo, latencia_ms)
       VALUES ('agente', $1, 1, 1, 999, 1)`,
      [MODELO],
    );
    enviado = undefined;
    await perguntar({ pergunta: 'quanto gastei?' }).expect(429);
    expect(enviado).toBeUndefined();
  });

  it('repassa quando o agente não está configurado', async () => {
    respostaAi = Response.json(
      { detail: 'agente_nao_configurado' },
      { status: 503 },
    );
    const { body } = await perguntar({ pergunta: 'quanto gastei?' }).expect(
      503,
    );
    expect(body.erro).toBe('agente_nao_configurado');
  });
});
