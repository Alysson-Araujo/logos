import { DEMO_ANALYST } from '../support/commands';

/**
 * Tela de login, contra a API de verdade.
 *
 * O que só o navegador prova aqui: o formulário vem preenchido pelo código (não
 * por um atributo do HTML), o erro de credencial chega pelo `401` da API e é
 * anunciado como região viva, e o caminho até a triagem de fato acontece.
 */
describe('Login', () => {
  it('abre com a credencial de demonstração preenchida e com as contas do seed', () => {
    cy.visitLogin();

    cy.get('#login-email').should('have.value', DEMO_ANALYST.email);
    cy.get('#login-password').should('have.value', DEMO_ANALYST.password);

    // Os rótulos ligam o campo ao texto: sem eles o leitor de tela anuncia
    // "caixa de edição" e nada mais.
    cy.get('label[for="login-email"]').should('contain.text', 'E-mail');
    cy.get('label[for="login-password"]').should('contain.text', 'Senha');

    cy.contains('Acesso de demonstração').should('be.visible');
    // A conta do convite pendente aparece sem senha: ela ainda não tem uma.
    cy.contains('convite pendente').should('be.visible');
    cy.contains('ADMIN').should('be.visible');
  });

  it('recusa credencial inválida e mantém a pessoa na tela', () => {
    cy.visitLogin();

    cy.get('#login-password').clear();
    cy.get('#login-password').type('senha-que-nao-e-a-do-seed');
    cy.get('form button[type="submit"]').click();

    cy.get('[role="alert"]').should('contain.text', 'Credenciais inválidas');
    cy.get('#login-email').should('be.visible');
    cy.get('#login-password').should('be.visible');
  });

  it('entra na triagem com a credencial do seed', () => {
    cy.visitLogin();
    cy.get('form button[type="submit"]').click();

    cy.get('#login-email').should('not.exist');
    cy.get('#incident-search').should('exist');
    cy.get('[data-testid="incident-row"]').should('have.length.at.least', 1);
  });
});
