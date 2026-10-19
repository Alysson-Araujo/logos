#!/usr/bin/env node
/**
 * Sobe a aplicação inteira e roda o E2E de navegador (issue #149).
 *
 * O problema que este script resolve: um teste de ponta a ponta precisa de
 * **três** coisas no ar ao mesmo tempo — banco migrado, API e front — e o
 * "funciona na minha máquina" costuma ser a diferença entre eles. Aqui a receita
 * é a mesma em qualquer lugar:
 *
 *   1. banco SQLite próprio (`backend/e2e.db`), recriado do zero a cada execução;
 *   2. migrações + seed pela mesma via do desenvolvimento (`alembic`, `app.infra.seed`);
 *   3. API com limite de requisições desligado (o teto por cliente existe para
 *      proteger a operação, não para reprovar teste);
 *   4. front **compilado** (`vite build` + `vite preview`), e não o servidor de
 *      desenvolvimento: é o artefato que vai para o ar;
 *   5. Cypress, com os endereços injetados por variável de ambiente.
 *
 * Nada disso toca o banco de desenvolvimento: `e2e.db` é descartável e está no
 * `.gitignore`.
 *
 * Uso:
 *   node scripts/e2e.mjs                  # sobe tudo, roda e derruba
 *   node scripts/e2e.mjs --spec conflito  # roda só um arquivo
 *   node scripts/e2e.mjs --keep-db        # reaproveita o banco da execução anterior
 *   node scripts/e2e.mjs --headed         # com navegador visível
 *   E2E_VERBOSE=1 node scripts/e2e.mjs    # mostra a saída da API e do Vite
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const BACKEND = join(RAIZ, 'backend');

const API_PORT = process.env.E2E_API_PORT ?? '8000';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5173';

// `127.0.0.1` e não `localhost`: em Windows e em vários runners o nome resolve
// para `::1` primeiro, e o servidor do Vite escuta em IPv4 — o sintoma seria um
// "connection refused" sem relação com o teste.
const APP_URL = `http://127.0.0.1:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}/api/v1`;
const BANCO = join(BACKEND, 'e2e.db');

const argumentos = process.argv.slice(2);

function valorDe(flag) {
  const indice = argumentos.indexOf(flag);
  return indice === -1 ? undefined : argumentos[indice + 1];
}

const opcoes = {
  keepDb: argumentos.includes('--keep-db'),
  headed: argumentos.includes('--headed'),
  spec: valorDe('--spec'),
};

/** `true` no Windows: os comandos do Node são `.cmd` e precisam de shell. */
const NO_WINDOWS = process.platform === 'win32';

/**
 * Interpretador Python do projeto.
 *
 * O README pede um `.venv` na raiz — e é onde o `pip install -e` cai. Preferir o
 * executável dele evita o erro mais comum de quem clona o repositório: rodar o
 * script com o Python do sistema, que não tem as dependências. Na CI não existe
 * `.venv`, e o `python` do runner já é o interpretador certo.
 */
const PYTHON = (() => {
  const basesDoVenv = [join(RAIZ, '.venv'), join(RAIZ, 'backend', '.venv')];
  const candidatos = basesDoVenv.map((base) =>
    NO_WINDOWS ? join(base, 'Scripts', 'python.exe') : join(base, 'bin', 'python'),
  );
  return candidatos.find((caminho) => existsSync(caminho)) ?? 'python';
})();

const processos = [];

/**
 * Mata o processo **e a árvore dele**.
 *
 * No Windows o `kill()` encerra só o `cmd.exe` criado pelo `shell`, e o
 * uvicorn/Vite de baixo continua vivo segurando a porta — a execução seguinte
 * falharia dizendo que a porta está em uso, longe da causa real.
 */
function matarArvore(filho) {
  if (filho.exitCode !== null || filho.killed) return;
  if (NO_WINDOWS) {
    spawn('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  filho.kill('SIGTERM');
}

function registrar(nome, comando, args, opcoesDeSpawn = {}) {
  const filho = spawn(comando, args, {
    cwd: RAIZ,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: NO_WINDOWS,
    ...opcoesDeSpawn,
  });
  processos.push({ nome, filho });

  // `stdio: 'inherit'` deixa os dois streams nulos — daí o encadeamento opcional.
  filho.stdout?.on('data', (pedaco) => {
    if (process.env.E2E_VERBOSE === '1') process.stdout.write(`[${nome}] ${String(pedaco)}`);
  });
  filho.stderr?.on('data', (pedaco) => {
    if (process.env.E2E_VERBOSE === '1') process.stderr.write(`[${nome}] ${String(pedaco)}`);
  });

  return filho;
}

function encerrarTudo() {
  for (const { filho } of processos) matarArvore(filho);
}

/** Roda um comando até o fim e falha com a saída completa quando ele falha. */
function executar(nome, comando, args, opcoesDeSpawn = {}) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(comando, args, {
      cwd: RAIZ,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: NO_WINDOWS,
      ...opcoesDeSpawn,
    });

    let saida = '';
    filho.stdout?.on('data', (pedaco) => {
      saida += String(pedaco);
    });
    filho.stderr?.on('data', (pedaco) => {
      saida += String(pedaco);
    });

    filho.on('close', (codigo) => {
      if (codigo === 0) {
        resolver(saida);
        return;
      }
      rejeitar(new Error(`${nome} falhou (código ${String(codigo)}):\n${saida}`));
    });
  });
}

async function esperar(url, descricao, tentativas = 90) {
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      const resposta = await fetch(url);
      if (resposta.ok) {
        console.log(`  ${descricao} respondeu.`);
        return;
      }
    } catch {
      // Ainda não subiu: o laço tenta de novo.
    }
    await new Promise((resolver) => setTimeout(resolver, 1000));
  }
  throw new Error(`${descricao} não respondeu em ${String(tentativas)} s: ${url}`);
}

/**
 * Variáveis da API.
 *
 * `RATE_LIMIT_ENABLED=false` é decisão, não conveniência: a suíte faz dezenas de
 * requisições do mesmo IP em segundos, e o teto de 20 escritas por minuto
 * reprovaria testes por um comportamento correto do produto.
 */
function ambienteDaApi() {
  return {
    ...process.env,
    ENVIRONMENT: 'local',
    DATABASE_URL: `sqlite:///${BANCO.replace(/\\/g, '/')}`,
    CORS_ORIGINS: `${APP_URL},http://localhost:${WEB_PORT}`,
    RATE_LIMIT_ENABLED: 'false',
    SEED_ON_STARTUP: 'false',
    LOG_LEVEL: 'WARNING',
  };
}

async function main() {
  console.log('E2E · preparando o banco descartável');
  if (!opcoes.keepDb && existsSync(BANCO)) await rm(BANCO, { force: true });

  console.log('E2E · migrações (alembic upgrade head)');
  // `python -m alembic` e não `alembic`: o executável só existe no PATH quando
  // o ambiente virtual está ativado, e o script não pode depender disso.
  await executar('alembic', PYTHON, ['-m', 'alembic', 'upgrade', 'head'], {
    cwd: BACKEND,
    env: ambienteDaApi(),
  });

  console.log('E2E · seed (120 incidentes e as contas de demonstração)');
  await executar('seed', PYTHON, ['-m', 'app.infra.seed'], {
    cwd: BACKEND,
    env: ambienteDaApi(),
  });

  console.log('E2E · subindo a API');
  registrar(
    'api',
    PYTHON,
    ['-m', 'uvicorn', 'app.main:app', '--port', API_PORT, '--host', '127.0.0.1'],
    { cwd: BACKEND, env: ambienteDaApi() },
  );
  await esperar(`${API_URL}/health/ready`, 'API');

  console.log('E2E · compilando o front (vite build)');
  await executar('build', 'pnpm', ['--filter', 'web', 'build'], {
    env: { ...process.env, VITE_API_BASE_URL: API_URL },
  });

  console.log('E2E · servindo o front compilado');
  registrar('web', 'pnpm', [
    '--filter',
    'web',
    'exec',
    'vite',
    'preview',
    '--port',
    WEB_PORT,
    '--strictPort',
    '--host',
    '127.0.0.1',
  ]);
  await esperar(APP_URL, 'front');

  console.log('E2E · rodando o Cypress');
  const argumentosDoCypress = ['--filter', 'web', 'e2e', '--browser', 'electron'];
  if (opcoes.headed) argumentosDoCypress.push('--headed');
  if (opcoes.spec !== undefined) {
    argumentosDoCypress.push('--spec', `cypress/e2e/${opcoes.spec}.cy.ts`);
  }

  return await new Promise((resolver) => {
    const cypress = registrar('cypress', 'pnpm', argumentosDoCypress, {
      stdio: 'inherit',
      env: { ...process.env, CYPRESS_BASE_URL: APP_URL, CYPRESS_API_URL: API_URL },
    });
    cypress.on('close', (codigo) => {
      resolver(codigo ?? 1);
    });
  });
}

let codigoDeSaida = 1;

try {
  codigoDeSaida = await main();
} catch (erro) {
  console.error(`\n${erro instanceof Error ? erro.message : String(erro)}`);
  codigoDeSaida = 1;
} finally {
  encerrarTudo();
}

if (codigoDeSaida === 0) {
  console.log('\nE2E · tudo verde.');
} else {
  console.error('\nE2E · falhou. Vídeos e prints em frontend/cypress/{videos,screenshots}.');
}

process.exit(codigoDeSaida);
