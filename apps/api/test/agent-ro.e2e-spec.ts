import pg from 'pg';

// Precisa do banco com as migrations aplicadas (DATABASE_URL do dono).
const ownerUrl = process.env.DATABASE_URL;
const AGENT_RO_PASSWORD = 'agent-ro-test';

describe('papel agent_ro', () => {
  let owner: pg.Client;
  let agent: pg.Client;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    // A migration cria o papel sem login; o teste habilita um login só para se conectar.
    await owner.query(`ALTER ROLE agent_ro LOGIN PASSWORD '${AGENT_RO_PASSWORD}'`);

    const url = new URL(ownerUrl!);
    url.username = 'agent_ro';
    url.password = AGENT_RO_PASSWORD;
    agent = new pg.Client({ connectionString: url.toString() });
    await agent.connect();
  });

  afterAll(async () => {
    await agent?.end();
    await owner?.end();
  });

  it.each(['v_compras', 'v_gasto_mensal', 'v_preco_produto'])('lê a view %s', async (view) => {
    await expect(agent.query(`SELECT * FROM ${view} LIMIT 1`)).resolves.toBeDefined();
  });

  it.each(['receipts', 'receipt_items', 'products', 'llm_calls', '_prisma_migrations'])(
    'não lê a tabela %s',
    async (table) => {
      await expect(agent.query(`SELECT * FROM ${table} LIMIT 1`)).rejects.toThrow(/permission denied/);
    },
  );

  it.each([
    `INSERT INTO import_errors (url, etapa, mensagem) VALUES ('x', 'x', 'x')`,
    `UPDATE receipts SET total = 0`,
    `DELETE FROM stores`,
    `CREATE TABLE invasora (id int)`,
  ])('não escreve: %s', async (sql) => {
    await expect(agent.query(sql)).rejects.toThrow(/permission denied|read-only transaction/);
  });
});
