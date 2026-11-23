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
 * Primeiros passos, passo 1: sem GitHub, a entrada pede "Entrar com GitHub" (Device Flow de
 * Integrações). Autorizar conecta a integração e o caminho segue para o Notion.
 */
test('entrar com GitHub conecta a integração e segue para o Notion', async () => {
  const dir = createUserDataDir()
  const { app, page } = await launchOrkio(
    dir,
    { githubDevice: 'pending' },
    { startPage: 'projects' }
  )
  try {
    // launchOrkio sai dos Primeiros passos; recarregar volta a eles (sem projetos).
    await page.reload()
    const steps = page.getByRole('list', { name: 'Primeiros passos' })
    await expect(steps).toBeVisible()
    await expect(steps.getByRole('listitem', { name: '1. Entrar com GitHub: agora' })).toBeVisible()
    const login = page.getByRole('region', { name: 'Entrar no Orkio' })
    await expect(login).toBeVisible()
    await login.getByRole('button', { name: 'Entrar com GitHub' }).click()
    await expect(login.locator('[data-testid="device-code"]')).toHaveText('WDJB-MJHT')
    await login.getByRole('button', { name: 'Abrir GitHub' }).click()
    await expect.poll(() => openedUrls(app)).toContain('https://github.com/login/device')

    await setFakes(app, { githubDevice: 'approve' })

    await expect(
      steps.getByRole('listitem', { name: /^1\. Entrar com GitHub: feito/ })
    ).toBeVisible({
      timeout: 15_000
    })
    // O caminho segue sozinho para o próximo passo pendente.
    await expect(page.getByRole('region', { name: 'Conectar o Notion' })).toBeVisible()
    await expect(page.getByTestId('setup-why')).toContainText('As tarefas vêm do Notion')
    await page.getByRole('button', { name: 'Fazer depois' }).click()
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible()
    expect(await cspViolations(page)).toEqual([])
  } finally {
    await app.close()
    removeDir(dir)
  }
})
