/**
 * Cadastro de incidente pelo painel lateral.
 *
 * O seed já cobre "abrir a lista e mudar status"; o que este spec prova é o
 * caminho de **entrada** do dado: validação que barra o envio incompleto e o
 * registro que passa a aparecer na fila com a criticidade escolhida.
 */
describe('Cadastro de incidente', () => {
  it('aponta os campos obrigatórios antes de enviar', () => {
    cy.login();

    cy.contains('button', 'Novo incidente').click();
    cy.get('[role="dialog"]').should('be.visible');

    cy.contains('button', 'Criar incidente').click();

    // Nada foi enviado: o resumo diz quantos campos faltam e a primeira linha
    // inválida recebe o foco.
    cy.get('#create-incident-summary').should('contain.text', 'precisam de atenção');
    cy.focused().should('have.id', 'create-incident-title');
    cy.get('[role="dialog"]').should('be.visible');
  });

  it('registra o incidente e ele entra na fila com a criticidade escolhida', () => {
    cy.login();

    const titulo = `Colisão em teste E2E ${String(Date.now())}`;

    cy.contains('button', 'Novo incidente').click();

    cy.get('#create-incident-title').type(titulo);
    cy.get('#create-incident-category').click();
    cy.get('[role="option"]').contains('Problema Mecânico').click();
    cy.get('#create-incident-criticality').click();
    cy.get('[role="option"]').contains('Alta').click();
    cy.get('#create-incident-reportedBy').type('Rádio Frota 12');

    cy.contains('button', 'Criar incidente').click();

    // O aviso confirma o registro e traz o código gerado pelo servidor.
    cy.contains('Incidente registrado').should('be.visible');
    cy.get('[role="dialog"]').should('not.exist');

    cy.get('#incident-search').type(titulo);
    cy.get('[data-testid="incident-row"]').should('have.length', 1);
    cy.get('[data-testid="incident-row"]').should('contain.text', 'Problema Mecânico');
    cy.get('[data-testid="incident-row"]').should('contain.text', 'Alta');
    cy.get('[data-testid="incident-row"] [data-testid="priority-pill"]').should('exist');
  });
});
