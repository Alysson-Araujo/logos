import { describe, expect, it } from 'vitest';

import {
  DEMO_ACCOUNTS,
  DEMO_ACCOUNTS_BY_ROLE,
  DEMO_ADMIN_CREDENTIALS,
  DEMO_CREDENTIALS,
  DEMO_INVITE_LABEL,
} from './demo';

/**
 * As credenciais de demonstração são uma promessa feita na tela de login e no
 * README: quem lê precisa conseguir entrar. Estes testes guardam o que é fácil
 * de quebrar sem perceber — uma conta que sai da lista por causa de um papel
 * errado, ou uma credencial de teste que passa a apontar para outro lugar.
 */
describe('credenciais de demonstração', () => {
  it('usa as contas do seed e cobre os três papéis', () => {
    expect(DEMO_ACCOUNTS.map((account) => account.email)).toEqual([
      'ana@autou.com.br',
      'carlos@autou.com.br',
      'alyssonaraujowork@gmail.com',
      'renata.lima@example.org',
      'admin@autou.com.br',
      'carlos.menezes@example.com',
      'marina@autou.com.br',
      'joana.prado@example.net',
      'marcos.tavares@example.org',
    ]);
    expect(new Set(DEMO_ACCOUNTS.map((account) => account.role))).toEqual(
      new Set(['ANALYST', 'ADMIN', 'REPORTER']),
    );
  });

  it('não aponta para domínio de gente real', () => {
    // Domínios reservados (RFC 2606), o domínio do próprio produto — as contas
    // que o edital documenta desde a primeira entrega — e a exceção deliberada
    // da conta pessoal de quem apresenta. O convite sai por SMTP de verdade.
    const reservados = ['example.com', 'example.org', 'example.net'];
    const dominioDoProduto = 'autou.com.br';
    const pessoal = 'alyssonaraujowork@gmail.com';

    const foraDosReservados = DEMO_ACCOUNTS.map((account) => account.email).filter(
      (email) =>
        email !== pessoal &&
        !email.endsWith(`@${dominioDoProduto}`) &&
        !reservados.some((dominio) => email.endsWith(`@${dominio}`)),
    );

    expect(foraDosReservados).toEqual([]);
  });

  it('leva toda conta para um grupo de papel', () => {
    // Um papel fora da ordem conhecida faria a conta desaparecer da caixa.
    expect(DEMO_ACCOUNTS_BY_ROLE.flatMap((group) => group.accounts)).toEqual([...DEMO_ACCOUNTS]);
  });

  it('mantém as credenciais do card dentro da lista', () => {
    expect(DEMO_ACCOUNTS).toContainEqual({ ...DEMO_CREDENTIALS, role: 'ANALYST' });
    expect(DEMO_ACCOUNTS).toContainEqual({ ...DEMO_ADMIN_CREDENTIALS, role: 'ADMIN' });
  });

  it('não inventa senha para o convite pendente', () => {
    const convidada = DEMO_ACCOUNTS.find(
      (account) => account.email === 'marcos.tavares@example.org',
    );

    expect(convidada?.password).toBeNull();
    expect(DEMO_INVITE_LABEL).toBe('convite pendente');
  });
});
