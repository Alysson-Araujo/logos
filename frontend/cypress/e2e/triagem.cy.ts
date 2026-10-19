import { apiCreateIncident } from '../support/api';
import { DEMO_ANALYST } from '../support/commands';

/** Extrai o número do texto do contador ("120 incidentes") e dos scores. */
function digitsOf(text: string): number {
  return Number(text.replace(/\D/g, ''));
}

/**
 * Cria um incidente pela API e devolve o registro.
 *
 * Preparar cenário por aqui é o que torna o teste independente do que o seed
 * sorteou: o título carrega o instante da execução, então nenhum outro
 * incidente casa com ele na busca.
 */
function seedIncident(overrides: Partial<Parameters<typeof apiCreateIncident>[1]> = {}) {
  return cy.apiLogin(DEMO_ANALYST).then((session) =>
    apiCreateIncident(session.token, {
      title: `Incidente de teste E2E ${String(Date.now())}`,
      category: 'PROBLEMA_MECANICO',
      criticality: 'BAIXA',
      reportedBy: 'Rádio Frota 12',
      ...overrides,
    }),
  );
}

describe('Triagem', () => {
  it('mostra a fila na ordem do score, do maior para o menor', () => {
    cy.login();

    cy.get('[data-testid="priority-pill"]').should('have.length.at.least', 5);
    cy.get('[data-testid="priority-pill"]').then(($pills) => {
      const naTela = [...$pills].map((pill) => digitsOf(pill.textContent));
      const ordenado = [...naTela].sort((a, b) => b - a);
      // A ordem da fila é o produto: se um score maior aparecer abaixo de um
      // menor, a promessa inteira do case cai.
      expect(naTela).to.deep.equal(ordenado);
    });
  });

  it('virtualiza a lista: o DOM tem menos linhas do que o total', () => {
    cy.login();

    cy.get('#incident-search')
      .closest('section')
      .find('[aria-live="polite"]')
      // Enquanto a primeira página não chega, o contador diz "carregando…" —
      // sem número nenhum. Esperar pelo texto evita ler zero e concluir que o
      // seed está vazio.
      .should('contain.text', 'incidentes')
      .invoke('text')
      .then((text) => {
        const total = digitsOf(text);
        expect(total, 'o seed precisa ter mais incidentes que a janela virtual').to.be.greaterThan(
          40,
        );
        cy.get('[data-testid="incident-row"]').should('have.length.at.most', 40);
      });
  });

  it('filtra por criticidade e deixa o filtro na URL (link compartilhável)', () => {
    cy.login();

    cy.get('[aria-label="Filtros"]').contains('button', 'Alta').click();

    cy.location('search').should('contain', 'criticality=ALTA');
    cy.get('[data-testid="incident-row"]').should('have.length.at.least', 1);
    cy.get('[data-testid="incident-row"]').each(($row) => {
      expect($row.attr('data-criticality')).to.equal('ALTA');
    });

    // O link é a promessa do filtro na URL: recarregar mantém a mesma visão.
    cy.reload();
    cy.get('[data-testid="incident-row"]').should('have.length.at.least', 1);
    cy.get('[data-testid="incident-row"]').each(($row) => {
      expect($row.attr('data-criticality')).to.equal('ALTA');
    });
  });

  it('recorta a fila pelo KPI de status', () => {
    cy.login();

    cy.get('[data-tour="kpis"] button').contains('Fechado').click();

    cy.location('search').should('contain', 'status=FECHADO');
    cy.get('[data-testid="incident-row"]').should('have.length.at.least', 1);
    cy.get('[data-testid="incident-row"]').each(($row) => {
      expect($row.attr('data-status')).to.equal('FECHADO');
    });
  });

  it('busca por código e isola um único incidente', () => {
    cy.login();

    seedIncident().then((incident) => {
      cy.get('#incident-search').type(incident.code);

      cy.get('[data-testid="incident-row"]').should('have.length', 1);
      cy.get('[data-testid="incident-row"]').should('contain.text', incident.code);
      cy.location('search').should('contain', encodeURIComponent(incident.code));
    });
  });

  it('navega com j e k e abre o incidente com Enter', () => {
    cy.login();

    // `j` anda pela ordem **publicada** — com a fila vazia não há para onde ir,
    // e a tecla não faz nada.
    cy.get('[data-testid="incident-row"]').should('have.length.at.least', 2);

    cy.get('body').type('j');
    cy.get('[data-testid="incident-row"][data-focused="true"]').should('have.length', 1);

    cy.get('[data-testid="incident-row"][data-focused="true"]').then(($row) => {
      const code = /INC-\d{4}-\d{6}/.exec($row.text())?.[0];
      expect(code, 'a linha em foco precisa ter um código').to.be.a('string');

      cy.get('body').type('{enter}');
      cy.get('[role="dialog"]')
        .should('be.visible')
        .should('contain.text', code ?? '');

      // `Esc` fecha o que estiver aberto — e o foco volta para a fila.
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"]').should('not.exist');
    });
  });

  it('o tema escolhido sobrevive ao recarregamento', () => {
    cy.login();

    // Estado de partida explícito: o tema padrão é o do sistema, e o teste não
    // pode depender de como o navegador de CI está configurado.
    cy.window().then((window) => {
      window.localStorage.setItem('logos-theme', 'light');
    });
    cy.reload();
    cy.get('html').should('not.have.class', 'dark');

    cy.get('button[aria-label="Ativar tema escuro"]').click();
    cy.get('html').should('have.class', 'dark');

    cy.reload();
    cy.get('html').should('have.class', 'dark');
    cy.get('button[aria-label="Ativar tema claro"]').should('exist');
  });
});
