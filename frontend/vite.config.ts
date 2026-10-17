import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        /**
         * A divisão é decidida por caminho de módulo, e não por nome de pacote.
         *
         * A forma de objeto casa com o **ponto de entrada** dos pacotes, não
         * com o interior deles: `react-dom` e `scheduler` caiam num chunk
         * enquanto o núcleo do `react` caia em outro, e os dois chunks passavam
         * a se importar mutuamente. Nessa dependência circular um dos lados
         * avalia com a ligação ainda `undefined`, e o primeiro `forwardRef`
         * derrubava a árvore inteira de módulos — o bundle de produção não
         * montava a aplicação (#110).
         *
         * Aqui todo o interior do React (núcleo, `react-dom`, `scheduler`) vai
         * para um chunk só, e as dependências passam a ser de mão única.
         */
        manualChunks(id: string) {
          const modulePath = id.replace(/\\/g, '/');
          if (!modulePath.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(modulePath)) return 'react';
          if (modulePath.includes('/node_modules/@tanstack/')) return 'query';
          if (modulePath.includes('/node_modules/@radix-ui/')) return 'radix';
          return undefined;
        },
      },
    },
  },
});
