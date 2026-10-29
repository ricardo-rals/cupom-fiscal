import { defineConfig, env } from 'prisma/config';

// Fora do Docker as variáveis vêm de apps/api/.env; no compose e na CI, do ambiente.
try {
  process.loadEnvFile();
} catch {
  // sem .env: usa o ambiente
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
