import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      ...loadEnv('test', process.cwd(), ''),
      NORMALIZACAO_WORKER: 'off',
      API_TOKEN_SECRET: 'segredo-dos-testes',
      OWNER_EMAIL: 'dono@teste.local',
    },
    // Os arquivos dividem o banco e a fila de jobs.
    fileParallelism: false,
    // Os testes da fila esperam o job por até 30 s; o padrão de 5 s cortava antes.
    testTimeout: 60_000,
  },
});
