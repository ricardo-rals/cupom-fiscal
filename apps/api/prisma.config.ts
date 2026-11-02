import { defineConfig } from 'prisma/config';

// Fora do Docker as variáveis vêm de apps/api/.env; no compose e na CI, do ambiente.
try {
  process.loadEnvFile();
} catch {
  // sem .env: usa o ambiente
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // O generate roda no build, sem banco; as migrations falham sozinhas se a URL faltar.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
