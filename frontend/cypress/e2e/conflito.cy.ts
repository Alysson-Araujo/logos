import {
  apiChangeIncidentStatus,
  apiCreateIncident,
  apiFindIncidentByCode,
  apiIncidentEvents,
} from '../support/api';
import { DEMO_ANALYST } from '../support/commands';

/**
 * O Pilar 1 no navegador (issue #149, ADR 0008).
 *
 * O cenário é o do case: dois analistas com a mesma versão do incidente na
 * tela. O primeiro fecha o caso; o segundo — que continua vendo a versão
 * antiga — tenta assumir a investigação por cima. O teste é a segunda pessoa.
 *
 * A mudança do colega é feita pela API de propósito: é a única forma de fazer o
 * servidor avançar **sem** que a tela do segundo analista perceba, que é
 * exatamente a condição real (dois navegadores, duas máquinas).
 *
 * O colega FECHA o caso, e não assume como o segundo tentaria: é assim que o
 * diff tem o que mostrar — status, justificativa e versão, os três diferentes.
 */
const NOTAS_DO_COLEGA =
  'Atendimento encerrado pela equipe 3: pista liberada às 14h20, sem vítimas.';

interface CenarioConflito {
  readonly id: string;
  readonly código: string;
}

/** Abre o caso na tela, fecha-o por fora e devolve o código para as asserções. */
function cenarioDeConflito(titulo: string): Cypress.Chainable<CenarioConflito> {
  return cy
    .apiLogin(DEMO_ANALYST)
    .then((session) =>
      apiCreateIncident(session.token, {
        title: `${titulo} ${String(Date.now())}`,
        category: 'ACIDENTE_COM_VEICULO',
        criticality: 'ALTA',
        reportedBy: 'PRF — trecho 412',
      }).then((incident) => ({ incident, token: session.token })),
    )
    .then(({ incident, token }) => {
      // Analista B abre o incidente: a tela guarda a versão 1.
      cy.login();
      cy.get('#incident-search').clear();
      cy.get('#incident-search').type(incident.code);
      cy.contains('[data-testid="incident-row"]', incident.code).click();
      cy.get('[role="dialog"]').should('be.visible');

      // Analista A fecha o caso antes, sem passar por esta tela.
      return apiFindIncidentByCode(token, incident.code)
        .then((atual) => apiChangeIncidentStatus(token, atual, 'FECHADO', NOTAS_DO_COLEGA))
        .then(() => ({ id: incident.id, código: incident.code }));
    });
}

describe('Conflito de versão (409)', () => {
  it('não sobrescreve o colega e mostra o que mudou, campo a campo', () => {
    cenarioDeConflito('Conflito de versão E2E').then(({ id, código }) => {
      // Analista B tenta assumir a investigação com a versão que viu (1).
      cy.contains('button', 'Assumir investigação').click();

      cy.get('[role="alertdialog"]')
        .should('be.visible')
        .and('contain.text', 'Alguém mudou este incidente antes de você');

      cy.get('[role="alertdialog"]').within(() => {
        // Cabeçalho da comparação.
        cy.contains('th', 'Você tentou').should('exist');
        cy.contains('th', 'No servidor está').should('exist');

        // O que ele tentou enviar e o que encontrou.
        cy.contains('td', 'Em Investigação').should('exist');
        cy.contains('td', 'Fechado').should('exist');
        cy.contains('td', NOTAS_DO_COLEGA).should('exist');
        cy.contains('td', 'v1').should('exist');
        cy.contains('td', 'v2').should('exist');
      });

      // A versão no servidor continua a do colega: nada foi sobrescrito.
      cy.apiLogin(DEMO_ANALYST).then((session) =>
        apiFindIncidentByCode(session.token, código).then((depois) => {
          expect(depois.status).to.equal('FECHADO');
          expect(depois.version).to.equal(2);
          expect(depois.resolutionNotes).to.equal(NOTAS_DO_COLEGA);
        }),
      );

      // E a tentativa recusada não virou histórico: o `409` não deixa rastro.
      cy.apiLogin(DEMO_ANALYST).then((session) =>
        apiIncidentEvents(session.token, id).then((eventos) => {
          expect(eventos).to.have.length(2);
          expect(eventos.at(-1)?.toStatus).to.equal('FECHADO');
        }),
      );
    });
  });

  it('recarregar do servidor deixa a tela alinhada e fecha o aviso', () => {
    cenarioDeConflito('Conflito e recarga E2E').then(({ código }) => {
      cy.contains('button', 'Assumir investigação').click();
      cy.get('[role="alertdialog"]').should('be.visible');

      cy.get('[role="alertdialog"]').contains('button', 'Recarregar').click();

      cy.get('[role="alertdialog"]').should('not.exist');
      cy.contains('Dados recarregados do servidor').should('be.visible');
      // A tela passou a mostrar o estado do colega — não o que estava em cache.
      cy.get('[role="dialog"]').should('contain.text', 'Fechado');
      cy.get('[role="dialog"]').should('contain.text', código);
      // E o caso fechado continua terminal na tela.
      cy.get('[role="dialog"]').should('contain.text', 'FECHADO é terminal');
    });
  });
});
