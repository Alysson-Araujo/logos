import { DEMO_ANALYST } from '../support/commands';

/**
 * Guia de boas-vindas (issue #131).
 *
 * O guia só existe no navegador: ele mede a posição real dos alvos no DOM e
 * recorta o véu em volta. Em `jsdom` essas medidas são zero, então o que a
 * suíte de componente consegue provar é pouco — aqui ele abre, avança e fecha
 * com a página montada.
 *
 * Nenhum teste deste arquivo marca o guia como visto: é justamente a primeira
 * visita que está sendo testada. A sessão é própria (`sessionId`) para não
 * contaminar o `localStorage` guardado pelos outros specs.
 */
const TOTAL_DE_PASSOS = 8;
const CARTAO = '[data-testid="tour-card"]';

/** Entra com a sessão do guia — que não carrega a marca de "já visto". */
function entrarParaVerOGuia(): void {
  cy.login(DEMO_ANALYST, { keepTour: true, sessionId: 'guia' });
}

function passoAtual(numero: number): void {
  cy.contains(`Passo ${String(numero)} de ${String(TOTAL_DE_PASSOS)}`).should('be.visible');
}

function avancar(): void {
  cy.contains('button', 'Próximo').click();
}

describe('Guia de boas-vindas', () => {
  it('abre sozinho na primeira visita e percorre os oito passos', () => {
    entrarParaVerOGuia();

    cy.get(CARTAO).should('be.visible').and('contain.text', 'Boas-vindas ao Logos');
    passoAtual(1);

    for (let passo = 2; passo <= TOTAL_DE_PASSOS; passo += 1) {
      avancar();
      passoAtual(passo);
    }

    // O último passo aponta para o próprio botão que reabre o passeio.
    cy.get(CARTAO).should('contain.text', 'Sempre que precisar');
    cy.contains('button', 'Concluir').click();

    cy.get(CARTAO).should('not.exist');
    // Fechado é fechado: a marca impede que ele volte na próxima visita.
    cy.window().should((window) => {
      expect(window.localStorage.getItem('logos.tour.v1')).to.equal('done');
    });
    cy.reload();
    cy.get(CARTAO).should('not.exist');
  });

  it('no passo do cadastro a janela abre sem prender o guia', () => {
    entrarParaVerOGuia();

    // O passo 4 é o do cadastro: ele abre a janela de novo incidente junto.
    for (let passo = 1; passo < 4; passo += 1) {
      avancar();
    }
    passoAtual(4);
    cy.get(CARTAO).should('contain.text', 'Registrar incidente');
    cy.get('#create-incident-title').should('be.visible');

    // A regressão que este passo cobre (#146): com a janela modal, o foco ficava
    // preso nela e os botões do cartão paravam de responder.
    avancar();
    passoAtual(5);
    cy.get('#create-incident-title').should('not.exist');

    // Fechar por aqui também não pode deixar o guia preso no passo do cadastro.
    cy.contains('button', 'Pular').click();
    cy.get(CARTAO).should('not.exist');
  });

  it('o botão Guia reabre o passeio a qualquer momento', () => {
    cy.login();

    cy.get('[data-tour="guide"]').contains('Guia').click();

    cy.get(CARTAO).should('be.visible').and('contain.text', 'Boas-vindas ao Logos');
    passoAtual(1);
    // `Anterior` fica desabilitado no primeiro passo: não há para onde voltar.
    cy.contains('button', 'Anterior').should('be.disabled');

    avancar();
    passoAtual(2);
    cy.contains('button', 'Anterior').click();
    passoAtual(1);

    cy.contains('button', 'Pular').click();
    cy.get(CARTAO).should('not.exist');
  });

  it('todo alvo do passeio existe na tela', () => {
    cy.login();

    // O guia só encontra o que está marcado com `data-tour`: se uma dessas
    // marcas sumir, o passo correspondente fica sem alvo e o cartão, solto.
    for (const alvo of [
      'kpis',
      'filters',
      'list',
      'create',
      'theme',
      'connection',
      'shortcuts',
      'guide',
    ]) {
      cy.get(`[data-tour="${alvo}"]`).should('exist');
    }
  });
});
