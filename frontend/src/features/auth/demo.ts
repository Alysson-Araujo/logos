import type { AuthRole } from './types';

/**
 * Credenciais de demonstração.
 *
 * Ficam no bundle de propósito: o edital pede a orientação de acesso na tela
 * inicial, o frame `Login · padrão` já as exibe e o `seed` da API cria
 * exatamente estas contas. A lista é uma só e a tela a agrupa por papel — a
 * mesma que o README repete.
 *
 * Não são segredo — são parte da demonstração — e a única consequência real é
 * que qualquer pessoa com o link entra; por isso o token vive em
 * `sessionStorage` e o TTL é curto.
 *
 * Os domínios são os reservados pela RFC 2606 (`example.com`, `example.org` e
 * `example.net`). As contas do edital vivem em `demo.example.com`, subdomínio do
 * reservado `example.com`: nunca resolve e nunca recebe e-mail, e ao mesmo tempo
 * as distingue das demais contas do seed. O convite sai por SMTP de verdade
 * (#129): o que não pode existir é conta de demonstração no domínio de um
 * terceiro, que entregaria credencial na caixa de entrada de um estranho no
 * primeiro "Reenviar" clicado. A conta pessoal de quem apresenta é a exceção
 * deliberada.
 */

/** Uma conta de demonstração: papel, e-mail e a senha que o seed grava. */
export interface DemoAccount {
  role: AuthRole;
  email: string;
  /** `null` no convite pendente: a senha temporária só existe no e-mail. */
  password: string | null;
}

/**
 * As contas que a caixa "Acesso de demonstração" lista e o `seed` cria — na
 * ordem dos grupos de papel, que é como a caixa as exibe.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { role: 'ANALYST', email: 'ana@demo.example.com', password: 'ana.logos2026' },
  { role: 'ANALYST', email: 'carlos@demo.example.com', password: 'carlos.logos2026' },
  {
    role: 'ANALYST',
    email: 'alyssonaraujowork@gmail.com',
    password: 'alysson.logos2026',
  },
  { role: 'ANALYST', email: 'renata.lima@example.org', password: 'renata.logos2026' },
  { role: 'ADMIN', email: 'admin@demo.example.com', password: 'admin.logos2026' },
  { role: 'ADMIN', email: 'carlos.menezes@example.com', password: 'carlos.logos2026' },
  { role: 'REPORTER', email: 'marina@demo.example.com', password: 'marina.logos2026' },
  { role: 'REPORTER', email: 'joana.prado@example.net', password: 'joana.logos2026' },
  { role: 'REPORTER', email: 'marcos.tavares@example.org', password: null },
];

/**
 * A credencial já preenchida no card do login.
 *
 * É a conta do edital: a tela abre pronta para entrar com um clique.
 */
export const DEMO_CREDENTIALS = {
  email: 'ana@demo.example.com',
  password: 'ana.logos2026',
} as const;

/**
 * A conta `ADMIN` do seed tomada como referência — o seed tem duas, esta e
 * `admin@demo.example.com`. É ela que abre a administração de contas no menu do
 * usuário: sem uma credencial de administrador, a tela nova ficaria inalcançável
 * na demonstração.
 */
export const DEMO_ADMIN_CREDENTIALS = {
  email: 'carlos.menezes@example.com',
  password: 'carlos.logos2026',
} as const;

/** Nome exibido no header quando a API simulada responde ao login. */
export const DEMO_USER_NAME = 'Ana Paula Ribeiro';

/** O que a caixa mostra no lugar da senha de quem ainda não definiu uma. */
export const DEMO_INVITE_LABEL = 'convite pendente';

export interface DemoRoleGroup {
  role: AuthRole;
  accounts: readonly DemoAccount[];
}

/**
 * A ordem dos papéis na caixa: primeiro quem enxerga a fila inteira, por último
 * quem só abre chamado — a mesma ordem em que alguém apresenta a aplicação.
 */
const DEMO_ROLE_ORDER: readonly AuthRole[] = ['ANALYST', 'ADMIN', 'REPORTER'];

/**
 * As mesmas contas agrupadas por papel — é assim que a tela de login as lista.
 *
 * Agrupado, e não numa linha por conta, porque a lista passou de duas contas: o
 * rótulo do papel cabe no cabeçalho do grupo e a linha fica só com o que se
 * copia (`e-mail · senha`).
 */
export const DEMO_ACCOUNTS_BY_ROLE: readonly DemoRoleGroup[] = DEMO_ROLE_ORDER.map((role) => ({
  role,
  accounts: DEMO_ACCOUNTS.filter((account) => account.role === role),
})).filter((group) => group.accounts.length > 0);
