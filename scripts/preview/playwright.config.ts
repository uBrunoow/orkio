import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * Prints da interface para revisão visual (não são testes: não entram no `pnpm e2e` nem no CI).
 * Rode com `pnpm preview:shots` (build de E2E + os specs desta pasta, que usam o fixture do E2E em
 * `../../e2e/fixtures`). Os prints vão para `SHOT_DIR` (padrão: `test-results/preview/`).
 */
process.env['SHOT_DIR'] ??= resolve(__dirname, '..', '..', 'test-results', 'preview')

export default defineConfig({
  testDir: __dirname,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'off' }
})
