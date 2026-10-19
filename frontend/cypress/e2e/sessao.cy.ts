import { apiPath } from '../support/api';
import { DEMO_ANALYST } from '../support/commands';

/** A sessão guardada em `sessionStorage`, no formato que o store grava. */
interface SessaoArmazenada {
  readonly accessToken: string;
}

const CHAVE_DA_SESSAO = 'logos-session';

/**
 * O token que o navegador está usando agora.
 *
 * A checagem de forma não é zelo excessivo: sem ela, um campo renomeado faz a
 * função devolver `undefined`, o Cypress passa o subject anterior adiante (a
 * própria `window`) e o cabeçalho vira `Bearer [object Window]` — a API responde
 * `401` e o teste **passa** provando o contrário do que diz.
 */
function tokenArmazenado(): Cypress.Chainable<string> {
  return cy.window().then((win) => {
    const raw = win.sessionStorage.getItem(CHAVE_DA_SESSAO);
    expect(raw, 'a sessão precisa estar em sessionStorage').to.not.equal(null);

    const sessao = JSON.parse(raw ?? '{}') as Partial<SessaoArmazenada>;
    if (typeof sessao.accessToken !== 'string' || sessao.accessToken === '') {
      throw new Error(`Sessão guardada sem accessToken: ${String(raw)}`);
    }
    return sessao.accessToken;
  });
}

/**
 * Sessão: o que acontece quando ela acaba.
 *
 * O token vive em `sessionStorage` e é revogado no servidor a cada logoff
 * (ADR 0015/0016). Estes dois testes provam as duas pontas no navegador: sair
 * invalida o token de verdade e um token inválido devolve a pessoa à tela de
 * login com o motivo escrito.
 */
describe('Sessão', () => {
  /**
   * Identificador de sessão novo a cada tentativa.
   *
   * Os dois testes daqui **revogam o próprio token**: com uma sessão em cache, a
   * segunda tentativa (o `retries: 1` do `runMode`) começaria com um token já
   * inválido e falharia por um motivo que não é o defeito. Um id novo força o
   * login pela interface em cada tentativa.
   */
  function sessaoDescartavel(nome: string): string {
    return `${nome}-${String(Date.now())}`;
  }

  it('o logoff encerra a sessão e o token deixa de valer na API', () => {
    cy.login(DEMO_ANALYST, { sessionId: sessaoDescartavel('logoff') });
    tokenArmazenado().as('token');

    cy.get('button[aria-label="Abrir menu do usuário"]').click();
    cy.contains('[role="menuitem"]', 'Sair').click();

    cy.get('#login-email').should('exist');
    cy.contains('Sessão encerrada').should('be.visible');

    // O token sai do storage no cliente…
    cy.window().should((window) => {
      expect(window.sessionStorage.getItem(CHAVE_DA_SESSAO)).to.equal(null);
    });

    // …e não vale mais no servidor: revogação de verdade, não só esquecimento.
    cy.get('@token').then((token) => {
      cy.request({
        method: 'GET',
        url: apiPath('/auth/me'),
        headers: { Authorization: `Bearer ${String(token)}` },
        failOnStatusCode: false,
      })
        .its('status')
        .should('equal', 401);
    });
  });

  it('token revogado no servidor devolve à tela de login avisando da sessão', () => {
    cy.login(DEMO_ANALYST, { sessionId: sessaoDescartavel('expirada') });

    tokenArmazenado().then((token) => {
      // O servidor invalida o token enquanto o navegador continua com ele
      // guardado — é o que a expiração significa para o cliente, e é o caminho
      // do `401`, não o do logoff, que limpa o storage antes de sair.
      cy.request({
        method: 'POST',
        url: apiPath('/auth/logout'),
        headers: { Authorization: `Bearer ${token}` },
      })
        .its('status')
        .should('equal', 204);

      cy.reload();

      cy.get('#login-email', { timeout: 20_000 }).should('exist');
      cy.contains('Sua sessão expirou').should('be.visible');
      cy.window().should((window) => {
        expect(window.sessionStorage.getItem(CHAVE_DA_SESSAO)).to.equal(null);
      });
    });
  });
});
