import { defineConfig } from '@playwright/test'

/**
 * Smoke test do app EMPACOTADO (Etapa 6B): roda contra o binário em dist/ (ou ORKIO_PACKAGED_APP).
 * Empacote antes: `pnpm dist:dir` (Linux/Windows) ou o build do mac. Rode com `pnpm smoke:packaged`.
 */
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'off' }
})
