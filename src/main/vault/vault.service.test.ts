import { describe, expect, it } from 'vitest'
import { emptyConfig, type OrkioConfig } from '../config/orkio-config'
import type { SecretStore } from '../storage/secure-store'
import { VAULT_MESSAGES, VaultService } from './vault.service'

const VALUE = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

function setup(options: { available?: boolean; readOnly?: boolean } = {}) {
  let config: OrkioConfig = emptyConfig()
  const data = new Map<string, string>()
  const store: SecretStore = {
    isAvailable: () => options.available !== false,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k)
  }
  const cfg = {
    readOnly: options.readOnly === true,
    get: () => config,
    update: async (mutate: (c: OrkioConfig) => OrkioConfig) => (config = mutate(config))
  }
  const vault = new VaultService({
    store,
    config: cfg,
    now: () => new Date('2026-11-25T10:00:00Z')
  })
  return { vault, data, config: () => config }
}

describe('VaultService', () => {
  it('salva criptografado no store e a visão nunca traz o valor', async () => {
    const { vault, data, config } = setup()
    const view = await vault.save({ name: 'GITHUB_TOKEN', note: 'leitura', value: VALUE })
    expect(data.get('vault-github-token')).toBe(VALUE)
    expect(JSON.stringify(view)).not.toContain(VALUE)
    expect(JSON.stringify(config())).not.toContain(VALUE)
    expect(view.secrets).toEqual([
      {
        name: 'GITHUB_TOKEN',
        note: 'leitura',
        createdAt: '2026-11-25T10:00:00.000Z',
        updatedAt: '2026-11-25T10:00:00.000Z',
        uses: []
      }
    ])
  })

  it('segredo novo exige valor; existente troca só a nota sem perder o valor', async () => {
    const { vault, data } = setup()
    await expect(vault.save({ name: 'API_KEY', note: '' })).rejects.toThrow(
      VAULT_MESSAGES.needsValue
    )
    await vault.save({ name: 'API_KEY', note: '', value: 'valor-1234' })
    await vault.save({ name: 'API_KEY', note: 'nova nota' })
    expect(data.get('vault-api-key')).toBe('valor-1234')
    expect(vault.view().secrets[0]!.note).toBe('nova nota')
  })

  it('recusa nome reservado, nota com segredo e sem criptografia (sem gravar nada)', async () => {
    const { vault } = setup()
    await expect(vault.save({ name: 'NODE_OPTIONS', note: '', value: 'x123' })).rejects.toThrow(
      /nome é do sistema/
    )
    await expect(
      vault.save({ name: 'ANTHROPIC_API_KEY', note: '', value: 'x123' })
    ).rejects.toThrow()
    await expect(
      vault.save({ name: 'OK_NAME', note: `token=${VALUE}`, value: 'x123' })
    ).rejects.toThrow(VAULT_MESSAGES.noteSecret)
    const off = setup({ available: false })
    await expect(off.vault.save({ name: 'OK_NAME', note: '', value: 'abcd' })).rejects.toThrow(
      VAULT_MESSAGES.unavailable
    )
    expect(off.data.size).toBe(0)
    expect(off.vault.view()).toEqual({ available: false, secrets: [] })
  })

  it('valuesFor só entrega o que está liberado para o uso', async () => {
    const { vault } = setup()
    await vault.save({ name: 'GH_MCP', note: '', value: 'v-github' })
    await vault.save({ name: 'DEPLOY_KEY', note: '', value: 'v-deploy' })
    await vault.setUses('GH_MCP', [{ kind: 'mcp', id: 'github' }])
    await vault.setUses('DEPLOY_KEY', [{ kind: 'agent', key: 'local:ana' }])

    expect(
      await vault.valuesFor({ kind: 'mcp', id: 'github' }, ['GH_MCP', 'DEPLOY_KEY', 'NOPE'])
    ).toEqual({
      values: { GH_MCP: 'v-github' },
      missing: ['NOPE'],
      denied: ['DEPLOY_KEY']
    })
    expect((await vault.valuesFor({ kind: 'agent', key: 'local:ana' })).values).toEqual({
      DEPLOY_KEY: 'v-deploy'
    })
    expect((await vault.valuesFor({ kind: 'agent', key: 'local:bia' })).values).toEqual({})
  })

  it('grant/revokeUse e remover apaga o valor e os metadados', async () => {
    const { vault, data, config } = setup()
    await vault.save({ name: 'GH_MCP', note: '', value: 'v-github' })
    await vault.grant(['GH_MCP'], { kind: 'mcp', id: 'github' })
    await vault.grant(['GH_MCP'], { kind: 'mcp', id: 'github' })
    expect(vault.meta('GH_MCP')!.uses).toEqual([{ kind: 'mcp', id: 'github' }])
    await vault.revokeUse({ kind: 'mcp', id: 'github' })
    expect(vault.meta('GH_MCP')!.uses).toEqual([])
    await vault.remove('GH_MCP')
    expect(data.size).toBe(0)
    expect(config()).not.toHaveProperty('vault')
  })

  it('config só leitura: recusa escrever (nem o valor vai ao store)', async () => {
    const { vault, data } = setup({ readOnly: true })
    await expect(vault.save({ name: 'X_KEY', note: '', value: 'abcd' })).rejects.toThrow(
      VAULT_MESSAGES.readOnly
    )
    expect(data.size).toBe(0)
  })
})
