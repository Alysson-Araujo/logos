import { defineConfig } from 'cypress';

/**
 * Configuração do E2E de navegador (issue #149).
 *
 * O teste roda contra a aplicação **e** a API de verdade: o `VITE_USE_MOCK` fica
 * de fora de propósito. Um E2E sobre a API simulada provaria que o mock e a
 * tela combinam entre si — que é o que os 234 testes de `jsdom` já fazem.
 *
 * Os endereços vêm do ambiente para que o mesmo arquivo sirva a três cenários:
 * o desenvolvimento local (`pnpm dev` em outra aba), o script `pnpm e2e` da
 * raiz (que sobe os dois serviços em portas dedicadas) e o job da CI.
 */
const baseUrl = process.env.CYPRESS_BASE_URL ?? 'http://localhost:5173';
const apiUrl = process.env.CYPRESS_API_URL ?? 'http://localhost:8000/api/v1';

export default defineConfig({
  e2e: {
    baseUrl,
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',

    // O frame de referência do projeto é 1440 × 900, e é nele que a triagem
    // mostra a lista e os KPIs lado a lado. Rodar em outra medida testaria
    // outra tela.
    viewportWidth: 1440,
    viewportHeight: 900,

    // Vídeo e print só interessam quando algo falha, mas o Cypress grava o
    // vídeo sempre — o job da CI publica a pasta apenas no caminho de falha.
    video: true,
    videoCompression: 24,

    // O guia de boas-vindas abre sozinho na primeira visita e cobre a tela. O
    // teste que quer vê-lo apaga esta marca antes de carregar; os demais a
    // recebem pronta, porque o guia não é o assunto deles.
    //
    // `expose` (e não `env`): são valores públicos de configuração, e o Cypress
    // 16 reservou `env` para o que passa por `cy.env`, tratado como dado
    // sensível — inclusive com borrão no relatório.
    expose: { apiUrl, tourStorageKey: 'logos.tour.v1' },

    defaultCommandTimeout: 10_000,
    // A primeira compilação do Vite em máquina fria é o passo mais lento da
    // suíte; 30 s evita reprovar por causa dela e continuar falhando por um
    // problema que não existe.
    pageLoadTimeout: 30_000,
    responseTimeout: 30_000,

    // Uma repetição no `run` (CI): uma falha intermitente de rede não deve
    // derrubar o job. No modo interativo a repetição só esconderia o erro de
    // quem está escrevendo o teste.
    retries: { runMode: 1, openMode: 0 },
  },
});
