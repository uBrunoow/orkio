/**
 * Fase 4: Segredos (Vault). Valor criptografado no `SecureStore` (`safeStorage`, chave
 * `vault-<nome>`), metadados na config. O valor só entra (salvar) e só sai para a execução
 * (`valuesFor`), nunca para o renderer nem para o log: a tela recebe `VaultView` (sem valores) e os
 * erros são textos fixos.
 */
import { DomainError } from '../errors'
import type { SecretStore } from '../storage/secure-store'
import type { ConfigStore } from '../storage/config-store'
import type { OrkioConfig } from '../config/orkio-config'
import { redactSecrets } from '../platform/redact'
import {
  SECRET_NOTE_MAX,
  VAULT_MAX,
  parseSecretUses,
  sameUse,
  secretAllows,
  secretNameProblem,
  secretValueProblem,
  vaultStoreKey,
  type SecretMeta,
  type SecretSaveInput,
  type SecretUse,
  type VaultView
} from '../../shared/vault'

export class VaultError extends DomainError {
  constructor(
    code: 'invalid' | 'unavailable' | 'not_found' | 'limit' | 'read_only',
    message: string
  ) {
    super(code, message)
    this.name = 'VaultError'
  }
}

export const VAULT_MESSAGES = {
  unavailable:
    'A criptografia do sistema não está disponível (Keychain, GNOME Keyring ou KWallet). Sem ela o Orkio não guarda segredos.',
  notFound: 'Esse segredo não existe mais.',
  needsValue: 'Cole o valor do segredo.',
  limit: `Você chegou ao limite de ${VAULT_MAX} segredos. Apague algum que não usa mais.`,
  readOnly: 'A configuração está em modo só leitura (aberta por uma versão mais nova do Orkio).',
  noteSecret: 'A nota parece ter um segredo. Ponha o valor só no campo do valor.',
  usesInvalid: 'Lista de quem pode usar inválida.'
} as const

export interface VaultDeps {
  store: SecretStore
  config: Pick<ConfigStore<OrkioConfig>, 'get' | 'update' | 'readOnly'>
  now?: () => Date
}

/** Valores liberados para uma execução (só no main) e o que faltou, pelo nome. */
export interface ResolvedSecrets {
  values: Record<string, string>
  /** Referenciados mas não existem (ou não deu para ler). */
  missing: string[]
  /** Existem, mas não estão liberados para este uso. */
  denied: string[]
}

export class VaultService {
  constructor(private readonly deps: VaultDeps) {}

  private metas(): SecretMeta[] {
    return this.deps.config.get().vault ?? []
  }

  view(): VaultView {
    return {
      available: this.deps.store.isAvailable(),
      secrets: this.metas().map((m) => ({ ...m, uses: [...m.uses] }))
    }
  }

  meta(name: string): SecretMeta | undefined {
    return this.metas().find((m) => m.name === name)
  }

  async save(input: SecretSaveInput): Promise<VaultView> {
    const nameProblem = secretNameProblem(input.name)
    if (nameProblem) throw new VaultError('invalid', nameProblem)
    const note = input.note.trim().slice(0, SECRET_NOTE_MAX)
    if (redactSecrets(note) !== note) throw new VaultError('invalid', VAULT_MESSAGES.noteSecret)
    if (this.deps.config.readOnly) throw new VaultError('read_only', VAULT_MESSAGES.readOnly)
    const existing = this.meta(input.name)
    if (!existing && input.value === undefined) {
      throw new VaultError('invalid', VAULT_MESSAGES.needsValue)
    }
    if (!existing && this.metas().length >= VAULT_MAX)
      throw new VaultError('limit', VAULT_MESSAGES.limit)
    if (input.value !== undefined) {
      const valueProblem = secretValueProblem(input.value)
      if (valueProblem) throw new VaultError('invalid', valueProblem)
      if (!this.deps.store.isAvailable()) {
        throw new VaultError('unavailable', VAULT_MESSAGES.unavailable)
      }
      // O valor nunca vai para mensagem de erro nem log: falha vira o texto fixo.
      try {
        await this.deps.store.set(vaultStoreKey(input.name), input.value)
      } catch {
        throw new VaultError('unavailable', VAULT_MESSAGES.unavailable)
      }
    }
    const at = this.now()
    await this.deps.config.update((c) => {
      const list = c.vault ?? []
      const current = list.find((m) => m.name === input.name)
      const next: SecretMeta = current
        ? { ...current, note, updatedAt: input.value !== undefined ? at : current.updatedAt }
        : { name: input.name, note, createdAt: at, updatedAt: at, uses: [] }
      return {
        ...c,
        vault: current ? list.map((m) => (m.name === input.name ? next : m)) : [...list, next]
      }
    })
    return this.view()
  }

  async remove(name: string): Promise<VaultView> {
    if (this.deps.config.readOnly) throw new VaultError('read_only', VAULT_MESSAGES.readOnly)
    if (!this.meta(name)) throw new VaultError('not_found', VAULT_MESSAGES.notFound)
    await this.deps.store.delete(vaultStoreKey(name))
    await this.deps.config.update((c) => {
      const vault = (c.vault ?? []).filter((m) => m.name !== name)
      const next: OrkioConfig = { ...c, vault }
      if (vault.length === 0) delete next.vault
      return next
    })
    return this.view()
  }

  async setUses(name: string, uses: SecretUse[]): Promise<VaultView> {
    if (this.deps.config.readOnly) throw new VaultError('read_only', VAULT_MESSAGES.readOnly)
    const clean = parseSecretUses(uses)
    if (!clean) throw new VaultError('invalid', VAULT_MESSAGES.usesInvalid)
    if (!this.meta(name)) throw new VaultError('not_found', VAULT_MESSAGES.notFound)
    await this.deps.config.update((c) => ({
      ...c,
      vault: (c.vault ?? []).map((m) => (m.name === name ? { ...m, uses: clean } : m))
    }))
    return this.view()
  }

  /** Libera (acrescenta) um uso a vários segredos (ex.: ao ligar um servidor do catálogo). */
  async grant(names: readonly string[], use: SecretUse): Promise<void> {
    if (names.length === 0 || this.deps.config.readOnly) return
    await this.deps.config.update((c) => ({
      ...c,
      vault: (c.vault ?? []).map((m) =>
        names.includes(m.name) && !m.uses.some((u) => sameUse(u, use))
          ? { ...m, uses: [...m.uses, use] }
          : m
      )
    }))
  }

  /** Tira um uso de todos os segredos (servidor removido). */
  async revokeUse(use: SecretUse): Promise<void> {
    if (this.deps.config.readOnly || !this.metas().some((m) => secretAllows(m, use))) return
    await this.deps.config.update((c) => ({
      ...c,
      vault: (c.vault ?? []).map((m) => ({ ...m, uses: m.uses.filter((u) => !sameUse(u, use)) }))
    }))
  }

  /**
   * Valores para uma execução (só no main). `names` = os que o servidor referencia; sem `names`,
   * todos os liberados para o uso (agente). Só sai o que está liberado para aquele uso.
   */
  async valuesFor(use: SecretUse, names?: readonly string[]): Promise<ResolvedSecrets> {
    const metas = this.metas()
    const wanted = names ?? metas.filter((m) => secretAllows(m, use)).map((m) => m.name)
    const out: ResolvedSecrets = { values: {}, missing: [], denied: [] }
    for (const name of wanted) {
      const meta = metas.find((m) => m.name === name)
      if (!meta) {
        out.missing.push(name)
        continue
      }
      if (!secretAllows(meta, use)) {
        out.denied.push(name)
        continue
      }
      try {
        const value = await this.deps.store.get(vaultStoreKey(name))
        if (value === null) out.missing.push(name)
        else out.values[name] = value
      } catch {
        out.missing.push(name)
      }
    }
    return out
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}
