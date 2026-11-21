import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    // Gerados pelo `astryx theme` (não editar à mão).
    ignores: [
      'out/**',
      'dist/**',
      // Site (Vercel): package próprio, com ESLint/TS/Vitest próprios (site/).
      'site/**',
      'node_modules/**',
      'themes/**',
      'src/themes/**',
      'src/astryx-themes.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      '*.config.ts',
      'e2e/**/*.ts',
      'e2e-packaged/**/*.ts',
      'test/**/*.ts'
    ],
    languageOptions: { globals: globals.node }
  },
  {
    // Cloudflare Worker: APIs web padrão (fetch, Request, btoa).
    files: ['broker/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    rules: {
      // Logs no processo main podem vazar segredos; use mensagens controladas.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    // Scripts de build rodam fora do app: podem usar console.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' }
  }
)
