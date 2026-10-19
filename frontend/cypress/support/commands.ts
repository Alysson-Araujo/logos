/**
 * Comandos compartilhados pelos specs (issue #149).
 *
 * O login é o passo mais caro da suíte — cada teste que entra pela interface
 * gasta uma ida ao servidor, um `GET /auth/me` e a montagem da triagem. O
 * `cy.session` guarda cookies e `sessionStorage` (onde vive o token) e devolve a
 * sessão pronta, o que também torna o teste independente da tela de login:
 * quando o login em si é o assunto, o spec entra pela interface sem atalho.
 */

import { apiLogin, env, type ApiSession, type Credentials } from './api';

/** Contas do seed — as mesmas que a caixa "Acesso de demonstração" lista. */
export const DEMO_ANALYST: Credentials = {
  email: 'ana@demo.example.com',
  password: 'ana.logos2026',
};

export const DEMO_ADMIN: Credentials = {
  email: 'carlos.menezes@example.com',
  password: 'carlos.logos2026',
};

export const DEMO_REPORTER: Credentials = {
  email: 'marina@demo.example.com',
  password: 'marina.logos2026',
};

/** A triagem está montada quando a busca existe — não depende de haver fila. */
const TRIAGE_READY = '#incident-search';

export interface LoginOptions {
  /**
   * Identificador da sessão em cache. Use um valor próprio em specs que
   * **encerram** a sessão (logoff), para não invalidar o cache dos demais.
   */
  readonly sessionId?: string;
  /** `true` deixa o guia de boas-vindas abrir, como na primeira visita. */
  readonly keepTour?: boolean;
}

/**
 * A marca que diz "o guia já foi visto".
 *
 * Ela entra antes de qualquer script da página, no mesmo caminho que o
 * `<script>` do `index.html` usa para evitar o flash de tema errado. Sem isso o
 * guia abre por cima da triagem e rouba o foco de todo teste que não é sobre ele.
 */
function markTourAsSeen(window: Window): void {
  window.localStorage.setItem(env().tourStorageKey, 'done');
}

/**
 * Abre a aplicação.
 *
 * Com `keepTour`, nenhuma marca é escrita: é assim que a aplicação vê quem
 * chega pela primeira vez — e é o que o spec do guia precisa.
 */
function openApp(keepTour: boolean): void {
  if (keepTour) {
    cy.visit('/');
    return;
  }
  cy.visit('/', { onBeforeLoad: markTourAsSeen });
}

/**
 * Login pela interface, do jeito que uma pessoa faz.
 *
 * Esta visita **não** marca o guia como visto de propósito: a sessão guardada
 * pelo `cy.session` carrega o `localStorage` do momento em que foi criada, e
 * uma marca gravada aqui reapareceria em todo teste que reusa a sessão — o spec
 * do guia nunca conseguiria vê-lo abrir. Quem decide é a visita de cada teste,
 * em `openApp`.
 */
function signIn(credentials: Credentials): void {
  cy.visit('/');

  cy.get('#login-email').clear();
  cy.get('#login-email').type(credentials.email);
  cy.get('#login-password').clear();
  cy.get('#login-password').type(credentials.password, { log: false });
  cy.get('form button[type="submit"]').click();

  cy.get('#login-email').should('not.exist');
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- aumentar o tipo do `cy` é a forma documentada pelo Cypress.
  namespace Cypress {
    interface Chainable {
      /** Entra na triagem com a sessão em cache (login pela interface na 1ª vez). */
      login(credentials?: Credentials, options?: LoginOptions): Chainable<void>;
      /** Abre a tela de login sem sessão, do zero. */
      visitLogin(): Chainable<void>;
      /** Autentica pela API e devolve o token, sem passar pela tela. */
      apiLogin(credentials: Credentials): Chainable<ApiSession>;
    }
  }
}

Cypress.Commands.add(
  'login',
  (credentials: Credentials = DEMO_ANALYST, options: LoginOptions = {}) => {
    const { sessionId, keepTour = false } = options;

    cy.session(
      [credentials.email, sessionId ?? 'triage'],
      () => {
        signIn(credentials);
      },
      // Guardar entre specs só é seguro quando a sessão não é encerrada por
      // nenhum deles: um logoff revogaria o token de todo mundo que o reusa.
      { cacheAcrossSpecs: sessionId === undefined },
    );

    // A sessão devolve cookies, `localStorage` e `sessionStorage` do momento em
    // que foi criada; a visita continua necessária porque o Cypress limpa a
    // página entre os testes.
    openApp(keepTour);
    cy.get(TRIAGE_READY, { timeout: 30_000 }).should('exist');
  },
);

Cypress.Commands.add('visitLogin', () => {
  cy.visit('/');
  cy.get('#login-email').should('exist');
});

Cypress.Commands.add('apiLogin', (credentials: Credentials) => apiLogin(credentials));
