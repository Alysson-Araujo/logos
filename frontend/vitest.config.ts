import { mergeConfig, defineConfig } from 'vitest/config';

import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      css: false,
      restoreMocks: true,
      clearMocks: true,
      testTimeout: 10_000,
      reporters: ['default'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        reportsDirectory: './coverage',
        include: ['src/**/*.{ts,tsx}'],
        // Fora da conta, e cada exclusão tem motivo:
        //
        // - `main.tsx` é o ponto de entrada: monta o React e nada mais. Testá-lo
        //   seria testar o React.
        // - `*.test.*` e o setup são o próprio aparato de teste; medi-los faria a
        //   cobertura subir sozinha, que é a forma mais fácil de mentir com
        //   cobertura.
        // - `src/test/**` são as fábricas e os handlers do MSW — apoio, não
        //   produto.
        // - `vite-env.d.ts` e afins são declaração de tipo, sem código executável.
        exclude: [
          'src/main.tsx',
          'src/**/*.test.{ts,tsx}',
          'src/**/*.d.ts',
          'src/test/**',
        ],
        // Piso, e não meta — a mesma regra do backend (`--cov-fail-under=80`).
        // O número existe para impedir que uma área fique **completamente** sem
        // teste, não para perseguir 100%: linha sem teste costuma ser linha que
        // não precisa existir.
        //
        // Medido em 2026-10-19, com a suíte em 234 testes.
        thresholds: {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },
  }),
);
