import { expect, test } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  launchOrkio,
  openedUrls,
  removeDir,
  setFakes
} from './fixtures'

/**
 * Login com GitHub na entrada: sem GitHub conectado, a tela inicial pede "Entrar com GitHub"
 * (Device Flow de Integrações). Autorizar conecta a integração e leva ao checklist, que já mostra
 * o GitHub pronto e pede Notion e projeto.
 */
test('entrar com GitHub conecta a integração e segue para o checklist', async () => {
  const dir = createUserDataDir()
  const { app, page } = await launchOrkio(
    dir,
    { githubDevice: 'pending' },
    { startPage: 'projects' }
  )
  try {
    // launchOrkio entra no app pulando o login; recarregar volta à tela inicial (sem projetos).
    await page.reload()
    const login = page.getByRole('region', { name: 'Entrar no Orkio' })
    await expect(login).toBeVisible()
    await login.getByRole('button', { name: 'Entrar com GitHub' }).click()
    await expect(login.locator('[data-testid="device-code"]')).toHaveText('WDJB-MJHT')
    await login.getByRole('button', { name: 'Abrir GitHub' }).click()
    await expect.poll(() => openedUrls(app)).toContain('https://github.com/login/device')

    await setFakes(app, { githubDevice: 'approve' })

    const setup = page.getByRole('list', { name: 'Preparar o Orkio' })
    await expect(setup).toBeVisible({ timeout: 15_000 })
    await expect(setup.getByRole('listitem').filter({ hasText: 'GitHub' })).toContainText(
      'Conectado'
    )
    await expect(setup.getByRole('button', { name: 'Conectar o GitHub' })).toHaveCount(0)
    await expect(setup.getByRole('button', { name: 'Conectar o Notion' })).toBeVisible()
    await page.getByRole('button', { name: 'Começar', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible()
    expect(await cspViolations(page)).toEqual([])
  } finally {
    await app.close()
    removeDir(dir)
  }
})
