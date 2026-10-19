import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Regras do plugin react-hooks, na forma aceita pelas versões 5.x e 6.x. */
const reactHooksRecommendedRules =
  reactHooks.configs.recommended?.rules ?? reactHooks.configs['recommended-latest'].rules;

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules', 'public/mockServiceWorker.js', '*.min.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    name: 'logos/typescript-typed',
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactHooksRecommendedRules,
      ...jsxA11y.configs.recommended.rules,
      'react/jsx-no-leaked-render': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Handlers síncronos que apenas retornam uma expressão `void` são idiomáticos em JSX.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    name: 'logos/config-files',
    // Arquivos que rodam no Node e **não** passam pelo `tsconfig` do projeto.
    //
    // `scripts/**/*.mjs` entrou porque o lint **abortava** ao encontrá-los: o
    // `strictTypeChecked` exige informação de tipo, e o `projectService` só está
    // declarado para `src/**`. O sintoma era pior do que um erro — o `eslint .`
    // parava de reportar os problemas do projeto inteiro por causa de um arquivo
    // de script. Um script de verificação não deve derrubar o lint do produto.
    files: [
      '*.config.{js,ts}',
      'postcss.config.js',
      'eslint.config.js',
      'scripts/**/*.{js,mjs,cjs}',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // O E2E roda no navegador (dentro do runner) e fala com a API pelo `cy`,
    // então enxerga os dois conjuntos de globais. O `projectService` aponta para
    // `cypress/tsconfig.json`: sem ele as regras que exigem tipo abortam o
    // `eslint .` inteiro, e o lint deixa de reportar o projeto todo por causa de
    // um arquivo de teste.
    name: 'logos/e2e',
    files: ['cypress/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  prettier,
);
