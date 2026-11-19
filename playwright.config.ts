import { defineConfig } from '@playwright/test'

/**
 * E2E do app Electron (build de produção em out/). Rode com `pnpm e2e`.
 * Não precisa de navegadores do Playwright: usamos o binário do Electron do projeto.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'off' }
})
