#!/usr/bin/env node
/**
 * Captura os prints da aplicação publicada para o README.
 *
 * Usa o **Microsoft Edge já instalado** (`channel: 'msedge'`) através do
 * `playwright-core`: nenhum navegador é baixado. Roda da **raiz** do
 * repositório, junto das outras ferramentas de `scripts/`.
 *
 * **Por que não em `frontend/scripts/`.** O `eslint.config.js` do frontend
 * aplica `tseslint.configs.strictTypeChecked` a todos os arquivos, mas só o
 * bloco `src/**` declara `projectService`. Um `.mjs` fora de `src/` faz as
 * regras que exigem tipo (`await-thenable`, `no-unsafe-*`) abortarem o
 * `eslint .` inteiro com "you have used a rule which requires type
 * information" — o lint deixa de reportar qualquer erro do projeto. Aqui, fora
 * do alcance do ESLint do frontend, o script não interfere no `pnpm lint`.
 *
 * Uso (da raiz do repositório):
 *   node scripts/captura.mjs                    # captura tudo
 *   node scripts/captura.mjs triagem login      # só as capturas nomeadas
 *
 * Dependência: `playwright-core` — `pnpm add -D playwright-core`. Não baixa
 * navegador nenhum (isso é o `playwright` completo, que não é necessário aqui).
 *
 * Variáveis de ambiente:
 *   LOGOS_APP_URL   sobrescreve a URL da aplicação publicada
 *
 * Saída: `docs/assets/*.png`, na raiz do repositório.
 */

import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Import dinâmico só para trocar o "Cannot find module 'playwright-core'" por
 * uma instrução acionável: a dependência é de ferramenta de documentação e
 * pode não estar instalada em quem só clonou o repositório.
 */
const { chromium } = await import('playwright-core').catch(() => {
  console.error(
    'Dependência ausente: playwright-core.\n' +
      'Instale com:  pnpm add -D playwright-core\n' +
      '(não baixa navegador — este script usa o Edge já instalado no sistema.)',
  );
  process.exit(1);
});

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const SAIDA = join(RAIZ, 'docs', 'assets');

const APP_URL = process.env.LOGOS_APP_URL ?? 'https://debpv51kciojx.cloudfront.net';

/** Credenciais do seed — as mesmas que a caixa "Acesso de demonstração" lista. */
const ANALISTA = { email: 'ana@demo.example.com', password: 'ana.logos2026' };
const ADMIN = { email: 'admin@demo.example.com', password: 'admin.logos2026' };

const DESKTOP = { width: 1440, height: 900 };
const CELULAR = { width: 390, height: 844 };

/** Acima disto o PNG engorda o repositório público sem necessidade. */
const LIMITE_KB = 400;

/* ------------------------------------------------------------------ */
/* Sessão                                                              */
/* ------------------------------------------------------------------ */

/**
 * Contexto isolado: cada captura começa com `sessionStorage` limpo, senão a
 * sessão da captura anterior sobrevive e a tela de login não aparece.
 *
 * O tema e o guia de boas-vindas entram por `addInitScript`, antes de qualquer
 * script da página — o mesmo caminho que o `<script>` do `index.html` usa para
 * evitar o flash de tema errado. O guia é marcado como visto para não abrir
 * sozinho por cima das telas.
 */
async function abrirSessao(browser, opcoes = {}) {
  const {
    tema = 'light',
    viewport = DESKTOP,
    deviceScaleFactor = 1,
    isMobile = false,
    hasTouch = false,
  } = opcoes;

  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: tema,
  });

  await context.addInitScript((temaEscolhido) => {
    try {
      window.localStorage.setItem('logos-theme', temaEscolhido);
      window.localStorage.setItem('logos.tour.v1', 'done');
    } catch {
      // Sem localStorage o app cai no tema do sistema; a captura segue.
    }
  }, tema);

  return context;
}

/** Espera fontes e animações assentarem antes do disparo. */
async function assentar(page, pausa = 500) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(pausa);
}

async function entrar(page, credenciais) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-email', { timeout: 30_000 });
  await page.fill('#login-email', credenciais.email);
  await page.fill('#login-password', credenciais.password);
  await page.click('form button[type="submit"]');
  await page.waitForSelector('[data-testid="incident-row"]', { timeout: 45_000 });
  await assentar(page, 900);
}

async function disparar(page, nome) {
  const arquivo = join(SAIDA, `${nome}.png`);
  await page.screenshot({ path: arquivo });
  const { size } = await stat(arquivo);
  return { nome, size };
}

/* ------------------------------------------------------------------ */
/* Capturas                                                            */
/* ------------------------------------------------------------------ */

const CAPTURAS = [
  {
    nome: 'login',
    descricao: 'Tela de login com a caixa de acesso de demonstração',
    async run(browser) {
      const context = await abrirSessao(browser);
      const page = await context.newPage();
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#login-email', { timeout: 30_000 });
      await page.getByText('Acesso de demonstração').waitFor({ timeout: 15_000 });
      await assentar(page);
      const r = await disparar(page, 'login');
      await context.close();
      return r;
    },
  },

  {
    nome: 'triagem',
    descricao: 'Triagem: KPIs, filtros e a fila ordenada por prioridade',
    async run(browser) {
      const context = await abrirSessao(browser);
      const page = await context.newPage();
      await entrar(page, ANALISTA);
      const r = await disparar(page, 'triagem');
      await context.close();
      return r;
    },
  },

  {
    nome: 'drawer-detalhe',
    descricao: 'Drawer de detalhe do incidente com transições, prazo e score',
    async run(browser) {
      const context = await abrirSessao(browser);
      const page = await context.newPage();
      await entrar(page, ANALISTA);

      await page.locator('[data-testid="incident-row"]').first().click();
      await page.waitForSelector('[role="dialog"]', { timeout: 20_000 });
      // O ponteiro parado sobre a linha abre o tooltip do score por cima do
      // painel; tirar o mouse de cima fecha o tooltip antes do disparo.
      await page.mouse.move(1400, 880);
      await page.getByText('Por que esta prioridade?').waitFor({ timeout: 20_000 });
      await assentar(page, 800);

      const r = await disparar(page, 'drawer-detalhe');
      await context.close();
      return r;
    },
  },

  {
    nome: 'novo-incidente',
    descricao: 'Formulário de novo incidente com as sugestões de placa abertas',
    async run(browser) {
      const context = await abrirSessao(browser);
      const page = await context.newPage();
      await entrar(page, ANALISTA);

      await page.click('[data-tour="create"]');
      await page.waitForSelector('#create-incident-title', { timeout: 20_000 });
      await page.fill('#create-incident-title', 'Pneu furado na BR-116, km 412');

      // Focar o campo abre a lista: com o campo vazio a consulta devolve os
      // primeiros veículos da frota, então a sugestão aparece sozinha.
      const placa = page.locator('#create-incident-truckPlate');
      await placa.click();
      await page.waitForSelector('[role="option"]', { timeout: 20_000 });

      // A frota tem 5.000 caminhões e a consulta é por **prefixo**. `BDI`
      // devolve dois veículos: com o campo em meia largura a descrição de cada
      // sugestão quebra em duas linhas (~64 px), então duas linhas cabem
      // inteiras abaixo do campo — três nasceriam cortadas na borda da área
      // rolável. Como nada transborda, o formulário não é rolado e o "Título",
      // que fica no topo, continua enquadrado.
      await placa.fill('BDI');
      await page.waitForFunction(
        () => document.querySelectorAll('[role="option"]').length === 2,
        undefined,
        { timeout: 20_000 },
      );
      // O ponteiro repousaria sobre a primeira sugestão e a destacaria; longe
      // do painel, a lista aparece em repouso.
      await page.mouse.move(1400, 880);
      await assentar(page, 800);

      const r = await disparar(page, 'novo-incidente');
      await context.close();
      return r;
    },
  },

  {
    nome: 'contas-de-acesso',
    descricao: 'Administração de contas de acesso, logado como ADMIN',
    async run(browser) {
      const context = await abrirSessao(browser);
      const page = await context.newPage();
      await entrar(page, ADMIN);

      // Deep link da tela; o papel ADMIN já está na sessão do contexto.
      await page.goto(`${APP_URL}/?view=contas`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1', { timeout: 20_000 });
      await page.locator('table tbody tr').first().waitFor({ timeout: 30_000 });
      await assentar(page, 900);

      const r = await disparar(page, 'contas-de-acesso');
      await context.close();
      return r;
    },
  },

  {
    nome: 'triagem-escuro',
    descricao: 'A triagem em tema escuro',
    async run(browser) {
      const context = await abrirSessao(browser, { tema: 'dark' });
      const page = await context.newPage();
      await entrar(page, ANALISTA);
      const r = await disparar(page, 'triagem-escuro');
      await context.close();
      return r;
    },
  },

  {
    nome: 'triagem-mobile',
    descricao: 'A triagem em largura de celular (390 × 844)',
    async run(browser) {
      const context = await abrirSessao(browser, {
        viewport: CELULAR,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await entrar(page, ANALISTA);
      const r = await disparar(page, 'triagem-mobile');
      await context.close();
      return r;
    },
  },
];

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

const filtro = process.argv.slice(2);
const selecionadas =
  filtro.length > 0 ? CAPTURAS.filter((c) => filtro.includes(c.nome)) : CAPTURAS;

if (selecionadas.length === 0) {
  console.error(`Nenhuma captura casa com: ${filtro.join(', ')}`);
  console.error(`Disponíveis: ${CAPTURAS.map((c) => c.nome).join(', ')}`);
  process.exit(1);
}

await mkdir(SAIDA, { recursive: true });

console.log(`Aplicação: ${APP_URL}`);
console.log(`Destino:   ${SAIDA}\n`);

const browser = await chromium.launch({ channel: 'msedge', headless: true });

const ok = [];
const falhas = [];

for (const captura of selecionadas) {
  process.stdout.write(`→ ${captura.nome} — ${captura.descricao}… `);
  try {
    const resultado = await captura.run(browser);
    ok.push(resultado);
    console.log(`ok (${(resultado.size / 1024).toFixed(0)} KB)`);
  } catch (erro) {
    falhas.push({ nome: captura.nome, erro });
    console.log(`FALHOU — ${erro.message.split('\n')[0]}`);
  }
}

await browser.close();

console.log('\n--- Tamanhos ---');
let total = 0;
for (const { nome, size } of ok) {
  total += size;
  const kb = size / 1024;
  const aviso = kb > LIMITE_KB ? '  ← acima do limite, otimizar' : '';
  console.log(`${nome.padEnd(18)} ${kb.toFixed(0).padStart(4)} KB${aviso}`);
}
console.log(`${'total'.padEnd(18)} ${(total / 1024).toFixed(0).padStart(4)} KB`);

if (falhas.length > 0) {
  console.log('\n--- Falhas ---');
  for (const { nome, erro } of falhas) console.log(`${nome}: ${erro.message}`);
  process.exitCode = 1;
}
