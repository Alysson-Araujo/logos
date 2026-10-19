import { apiCreateIncident, apiListAccounts, apiPath, uniqueEmail } from '../support/api';
import { DEMO_ADMIN, DEMO_ANALYST, DEMO_REPORTER } from '../support/commands';

/**
 * Administração de contas (issue #128), alcançável só por `ADMIN`.
 *
 * Os dois lados da mesma autorização: o que o `ADMIN` faz pela tela e o que o
 * `REPORTER` não faz nem chamando a API direto — esconder o item do menu não é
 * a proteção, é conveniência.
 */
describe('Contas de acesso', () => {
  it('o ADMIN convida uma conta e a vê como convite pendente', () => {
    const email = uniqueEmail('e2e.convite');

    cy.login(DEMO_ADMIN);

    cy.get('button[aria-label="Abrir menu do usuário"]').click();
    cy.contains('[role="menuitem"]', 'Contas de acesso').click();
    cy.contains('h1', 'Contas de acesso').should('be.visible');

    cy.contains('button', 'Nova conta').click();
    cy.get('#conta-email').type(email);
    cy.get('#conta-papel').click();
    cy.get('[role="option"]').contains('REPORTER').click();
    cy.contains('button', 'Enviar convite').click();

    // A senha temporária sai por e-mail (ou pelo log, sem SMTP): a tela confirma
    // o convite e nunca mostra a senha.
    cy.contains('Convite enviado para').should('be.visible').and('contain.text', email);

    cy.get('[aria-label="Buscar por nome ou e-mail"]').clear();
    cy.get('[aria-label="Buscar por nome ou e-mail"]').type(email);
    cy.get('tr[data-state="pending"]').should('have.length', 1).and('contain.text', email);

    // E a conta existe do lado do servidor, no estado que a tela mostra.
    cy.apiLogin(DEMO_ADMIN).then((session) =>
      apiListAccounts(session.token).then((contas) => {
        const criada = contas.find((conta) => conta.email === email);
        expect(criada, 'a conta convidada precisa existir na API').to.not.equal(undefined);
        expect(criada?.role).to.equal('REPORTER');
        expect(criada?.invitePending).to.equal(true);
        expect(criada?.lastLoginAt).to.equal(null);
      }),
    );
  });

  it('o REPORTER não alcança a administração de contas', () => {
    cy.login(DEMO_REPORTER);

    cy.get('button[aria-label="Abrir menu do usuário"]').click();
    cy.get('[role="menu"]').should('be.visible');
    cy.get('[role="menuitem"]').should('not.contain.text', 'Contas de acesso');
    cy.get('body').type('{esc}');

    // A API recusa de verdade: `403` para quem não administra contas.
    cy.apiLogin(DEMO_REPORTER).then((session) => {
      cy.request({
        method: 'GET',
        url: apiPath('/users'),
        headers: { Authorization: `Bearer ${session.token}` },
        failOnStatusCode: false,
      })
        .its('status')
        .should('equal', 403);
    });
  });

  it('o REPORTER só enxerga os incidentes que ele mesmo abriu', () => {
    const titulo = `Incidente do repórter E2E ${String(Date.now())}`;

    const tituloDoAnalista = `Incidente do analista E2E ${String(Date.now())}`;

    // Duas contas diferentes criam um incidente cada. É o par que prova o
    // recorte: o mesmo `GET /incidents` devolve recortes distintos por papel.
    cy.apiLogin(DEMO_ANALYST)
      .then((session) =>
        apiCreateIncident(session.token, {
          title: tituloDoAnalista,
          category: 'ACIDENTE_COM_VEICULO',
          criticality: 'MEDIA',
          reportedBy: 'Rádio Frota 12',
        }),
      )
      .then(() => cy.apiLogin(DEMO_REPORTER))
      .then((session) =>
        apiCreateIncident(session.token, {
          title: titulo,
          category: 'PROBLEMA_MECANICO',
          criticality: 'BAIXA',
          reportedBy: 'App do motorista',
        }),
      )
      .then(() => {
        cy.login(DEMO_REPORTER);

        // O recorte por papel entra no `WHERE`: a fila dele tem o que ele abriu.
        cy.get('#incident-search').clear();
        cy.get('#incident-search').type(titulo);
        cy.get('[data-testid="incident-row"]').should('have.length', 1);
        cy.get('[data-testid="incident-row"]').should('contain.text', titulo);

        // E não tem o que **outra pessoa** abriu, mesmo com o código em mãos.
        cy.get('#incident-search').clear();
        cy.get('#incident-search').type(tituloDoAnalista);
        cy.get('[data-testid="incident-row"]').should('have.length', 0);
        cy.contains('Nenhum resultado').should('be.visible');
      });
  });
});
