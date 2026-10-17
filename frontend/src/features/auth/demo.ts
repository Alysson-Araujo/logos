/**
 * Credenciais de demonstração.
 *
 * Ficam no bundle de propósito: o edital pede a orientação de acesso na tela
 * inicial, o frame `Login · padrão` já as exibe e o `seed` da API cria
 * exatamente este usuário (perfil `ANALYST`, o que vê a fila inteira).
 *
 * Não são segredo — são parte da demonstração — e o README as repete. A única
 * consequência real é que qualquer pessoa com o link entra; por isso o token
 * vive em `sessionStorage` e o TTL é curto.
 */
export const DEMO_CREDENTIALS = {
  email: 'ana@autou.com.br',
  password: 'ana.logos2026',
} as const;

/** Nome exibido no header quando a API simulada responde ao login. */
export const DEMO_USER_NAME = 'Ana Paula Ribeiro';
