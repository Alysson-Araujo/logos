import { apiCreateIncident, apiIncidentEvents } from '../support/api';
import { DEMO_ANALYST } from '../support/commands';

/**
 * Ciclo de vida no drawer: transições permitidas, justificativa obrigatória e a
 * auditoria que fica gravada.
 *
 * Cada teste cria o **próprio** incidente pela API: assim o estado de partida é
 * conhecido (`ABERTO`, versão 1) e a ordem de execução dos specs deixa de
 * importar.
 */
function seedOpenIncident() {
  return cy.apiLogin(DEMO_ANALYST).then((session) => {
    return apiCreateIncident(session.token, {
      title: `Bloqueio de pista E2E ${String(Date.now())}`,
      category: 'BLOQUEIO_DE_PISTA',
      criticality: 'MEDIA',
      reportedBy: 'Concessionária E2E',
    });
  });
}

function openIncident(code: string): void {
  cy.login();
  cy.get('#incident-search').clear();
  cy.get('#incident-search').type(code);
  cy.contains('[data-testid="incident-row"]', code).click();
  cy.get('[role="dialog"]').should('be.visible').should('contain.text', code);
}

describe('Ciclo de vida do incidente', () => {
  it('assume a investigação pelo drawer', () => {
    seedOpenIncident().then((incident) => {
      openIncident(incident.code);

      cy.contains('button', 'Assumir investigação').click();

      cy.contains('Status atualizado para Em Investigação').should('be.visible');
      cy.get('[role="dialog"]').should('contain.text', 'Em Investigação');
      // A transição de volta passa a ser oferecida: o ciclo continua aberto.
      cy.contains('button', 'Devolver para a fila').should('be.visible');
    });
  });

  it('exige justificativa de 10 caracteres para fechar o caso', () => {
    seedOpenIncident().then((incident) => {
      openIncident(incident.code);

      cy.contains('button', 'Fechar caso').click();
      cy.get('#resolution-notes').should('be.visible');

      cy.get('#resolution-notes').type('curto');
      cy.contains('button', 'Confirmar mudança').click();
      cy.get('[role="alert"]').should(
        'contain.text',
        'Justificativa obrigatória com pelo menos 10 caracteres',
      );
      // O caso continua aberto: a validação barrou antes de chamar a API.
      cy.get('[role="dialog"]').should('contain.text', 'Aberto');

      cy.get('#resolution-notes').clear();
      cy.get('#resolution-notes').type('Pista liberada às 14h20, sem vítimas, guincho acionado.');
      cy.contains('button', 'Confirmar mudança').click();

      cy.contains('Status atualizado para Fechado').should('be.visible');
      cy.get('[role="dialog"]').should('contain.text', 'Justificativa registrada');
      cy.get('[role="dialog"]').should('contain.text', 'Pista liberada às 14h20');
      // `FECHADO` é terminal: nenhuma transição é oferecida.
      cy.get('[role="dialog"]').should('contain.text', 'FECHADO é terminal');
    });
  });

  it('a mudança feita na tela fica registrada na auditoria', () => {
    seedOpenIncident().then((incident) => {
      openIncident(incident.code);
      cy.contains('button', 'Assumir investigação').click();
      cy.contains('Status atualizado para Em Investigação').should('be.visible');

      // A conferência é na API porque nenhuma tela mostra a timeline ainda: o
      // que se está provando é que o clique virou evento persistido.
      cy.apiLogin(DEMO_ANALYST).then((session) =>
        apiIncidentEvents(session.token, incident.id).then((events) => {
          const tipos = events.map((event) => event.eventType);
          expect(tipos).to.include('CREATED');
          expect(tipos).to.include('STATUS_CHANGED');
          expect(events.at(-1)?.toStatus).to.equal('EM_INVESTIGACAO');
          // O autor vem do token, não do corpo da requisição: um cliente não
          // escolhe quem foi o responsável.
          expect(events.at(-1)?.actor).to.be.a('string');
          expect(String(events.at(-1)?.actor)).to.not.equal('');
        }),
      );
    });
  });

  it('libera o caso de volta para a fila', () => {
    seedOpenIncident().then((incident) => {
      openIncident(incident.code);

      cy.contains('button', 'Assumir investigação').click();
      cy.contains('Status atualizado para Em Investigação').should('be.visible');

      cy.contains('button', 'Devolver para a fila').click();
      cy.contains('Status atualizado para Aberto').should('be.visible');
      cy.get('[role="dialog"]').should('contain.text', 'Aberto');
    });
  });
});
