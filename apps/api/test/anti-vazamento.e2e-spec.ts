import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

const PADRAO_CPF = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/;
const MARCADOR = '000.000.000-00'; // inválido de propósito: nunca é o CPF de alguém
const URL_BASE = 'http://nfe.sefaz.ba.gov.br/teste-anti-vazamento';

describe('anti-vazamento de CPF', () => {
  let app: INestApplication<App>;
  let db: pg.Client;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await db.query('DELETE FROM import_errors WHERE url LIKE $1', [`${URL_BASE}%`]);
    await db.end();
    await app.close();
  });

  it.each([
    ['com pontuação', MARCADOR],
    ['sem pontuação', '00000000000'],
  ])('URL com CPF %s não vai para o banco nem para os logs', async (_, cpf) => {
    const saida = vi.spyOn(process.stdout, 'write');
    const erros = vi.spyOn(process.stderr, 'write');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({}, { status: 502 })),
    );
    const url = `${URL_BASE}?cpf=${cpf}&caso=${encodeURIComponent(_)}`;

    await request(app.getHttpServer()).post('/receipts/qr').send({ url }).expect(502);

    const { rows } = await db.query<{ url: string }>(
      'SELECT url FROM import_errors WHERE url LIKE $1',
      [`${URL_BASE}%${encodeURIComponent(_)}`],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].url).not.toContain(cpf);
    expect(rows[0].url).toContain('[cpf]');

    const escrito = [...saida.mock.calls, ...erros.mock.calls].map(([t]) => String(t)).join('');
    expect(escrito).not.toContain(cpf);
  });

  it('nenhuma tabela guarda padrão de CPF', async () => {
    const { rows: tabelas } = await db.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'`);
    expect(tabelas.length).toBeGreaterThan(0);

    const comCpf: string[] = [];
    for (const { table_name: tabela } of tabelas) {
      const { rows } = await db.query<{ linha: string }>(
        `SELECT t::text AS linha FROM "${tabela}" t`,
      );
      if (rows.some(({ linha }) => PADRAO_CPF.test(linha))) comCpf.push(tabela);
    }
    expect(comCpf).toEqual([]);
  });
});
