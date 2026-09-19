import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.serviceworker,
        chrome: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
    },
  },
  {
    // Todo lo que corre en Node y no en el navegador: tests y las herramientas
    // de `scripts/`. Sin esto el editor marca `process` como no definido.
    files: ['tests/**/*.js', '**/*.test.js', 'scripts/**/*.{js,mjs}', '*.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Los snippets de `scripts/snippets/` no son modulos: son cuerpos de funcion
    // que `browser-eval` pega dentro de un `(async () => { ... })()`, asi que
    // usan `await` y `return` sueltos y no se pueden parsear como archivo.
    ignores: ['dist/**', 'packages/**', 'node_modules/**', 'scripts/snippets/**'],
  },
];
