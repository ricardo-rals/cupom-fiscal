import pg from 'pg';

describe('taxonomia', () => {
  let db: pg.Client;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
  });

  afterAll(() => db.end());

  it('tem 11 grupos e 43 categorias', async () => {
    const { rows } = await db.query(`
      SELECT count(*) FILTER (WHERE pai_id IS NULL)::int     AS grupos,
             count(*) FILTER (WHERE pai_id IS NOT NULL)::int AS categorias
      FROM categories`);
    expect(rows[0]).toEqual({ grupos: 11, categorias: 43 });
  });

  it('não tem grupo vazio nem mais de dois níveis', async () => {
    const { rows } = await db.query(`
      SELECT g.nome FROM categories g
      WHERE g.pai_id IS NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.pai_id = g.id)
      UNION ALL
      SELECT c.nome FROM categories c JOIN categories n ON n.pai_id = c.id WHERE c.pai_id IS NOT NULL`);
    expect(rows).toEqual([]);
  });

  it('mantém a acentuação e o grupo da categoria', async () => {
    const { rows } = await db.query(`
      SELECT g.nome FROM categories c JOIN categories g ON g.id = c.pai_id
      WHERE c.nome = 'Óleos, azeites e vinagres'`);
    expect(rows).toEqual([{ nome: 'Mercearia' }]);
  });
});
