import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: loadEnv('test', process.cwd(), ''),
  },
});
