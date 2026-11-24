/**
 * Base dos conectores: a conexão salva (criptografada) e as regras de status iguais para todo
 * serviço. Cada conector só implementa a leitura do registro (`parse`), o "quem sou eu" e o login.
 *
 * - `load` nunca lança: arquivo ilegível/inválido vira `error` com `hasStoredCredentials`.
 * - `saveAndReport`: grava e devolve `connected`, ou o erro de armazenamento (sem texto puro).
 * - `revalidate` (o `testConnection`): falha transitória (rede, 5xx, 429...) mantém conectado com
 *   aviso; recusa da conta vira erro mantendo o arquivo até desconectar ou reconectar.
 */
import type { ConnectedAccount, ConnectionStatus } from '../../shared/connection'
import { isApiError, isTransientApiError, type ApiError } from '../net/http'
import { EncryptionUnavailableError, type SecretStore } from '../storage/secure-store'

/** O que todo registro salvo tem (o resto é do serviço). */
export interface StoredRecordBase {
  account: ConnectedAccount
  connectedAt: string
}

export type LoadedConnection<TRecord> =
  { kind: 'none' } | { kind: 'ok'; record: TRecord } | { kind: 'error'; status: ConnectionStatus }

export type ConnectedStatus = Extract<ConnectionStatus, { state: 'connected' }>

/** Mensagens comuns aos conectores, com o nome do serviço ("Notion", "GitHub"). */
export function connectionMessages(name: string) {
  return {
    emptyToken: `Cole o token do ${name} para conectar.`,
    malformedToken: 'Esse token não parece válido. Copie o token completo, sem espaços.',
    encryptionUnavailable:
      'Seu sistema não oferece armazenamento seguro de credenciais (keychain/keyring). ' +
      'O token não foi salvo. No Linux, instale e desbloqueie o GNOME Keyring ou o KWallet.',
    storageReadFailed: `Não foi possível ler a conexão salva com o ${name}. Desconecte e conecte novamente.`,
    storageWriteFailed: `Não foi possível salvar a conexão com o ${name}. Tente novamente.`,
    unknown: `Algo deu errado ao falar com o ${name}. Tente novamente.`,
    notConnected: `Conecte sua conta do ${name} em Integrações para continuar.`
  } as const
}

export type ConnectionMessages = ReturnType<typeof connectionMessages>

export function connected(record: StoredRecordBase): ConnectedStatus {
  return { state: 'connected', account: record.account, connectedAt: record.connectedAt }
}

export function errorStatus(message: string): ConnectionStatus {
  return { state: 'error', message }
}

export interface StoredConnectionOptions<TRecord> {
  store: SecretStore
  /** Chave no `SecretStore` (`secrets/<key>.bin`). */
  key: string
  name: string
  /** Lê o JSON salvo; `null` = registro inválido. */
  parse(value: unknown): TRecord | null
  maxTokenLength: number
}

export class StoredConnection<TRecord extends StoredRecordBase> {
  readonly messages: ConnectionMessages

  constructor(private readonly options: StoredConnectionOptions<TRecord>) {
    this.messages = connectionMessages(options.name)
  }

  isAvailable(): boolean {
    return this.options.store.isAvailable()
  }

  async load(): Promise<LoadedConnection<TRecord>> {
    let raw: string | null
    try {
      raw = await this.options.store.get(this.options.key)
    } catch (e) {
      const message =
        e instanceof EncryptionUnavailableError
          ? this.messages.encryptionUnavailable
          : this.messages.storageReadFailed
      return { kind: 'error', status: { state: 'error', message, hasStoredCredentials: true } }
    }
    if (raw === null) return { kind: 'none' }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      value = null
    }
    const record = this.options.parse(value)
    if (!record) {
      return {
        kind: 'error',
        status: {
          state: 'error',
          message: this.messages.storageReadFailed,
          hasStoredCredentials: true
        }
      }
    }
    return { kind: 'ok', record }
  }

  async save(record: TRecord): Promise<void> {
    await this.options.store.set(this.options.key, JSON.stringify(record))
  }

  async delete(): Promise<void> {
    await this.options.store.delete(this.options.key)
  }

  async saveAndReport(record: TRecord): Promise<ConnectionStatus> {
    try {
      await this.save(record)
    } catch (e) {
      return errorStatus(
        e instanceof EncryptionUnavailableError
          ? this.messages.encryptionUnavailable
          : this.messages.storageWriteFailed
      )
    }
    return connected(record)
  }

  /** Erro mantendo o "há conexão salva" (oferece Tentar de novo/Desconectar em vez do formulário). */
  async errorKeepingStored(message: string): Promise<ConnectionStatus> {
    const loaded = await this.load()
    return loaded.kind === 'none'
      ? errorStatus(message)
      : { state: 'error', message, hasStoredCredentials: true }
  }

  /** Status salvo, sem rede. */
  async status(): Promise<ConnectionStatus> {
    const loaded = await this.load()
    if (loaded.kind === 'none') return { state: 'disconnected' }
    if (loaded.kind === 'error') return loaded.status
    return connected(loaded.record)
  }

  /**
   * Revalida a conexão salva: `whoami` chama o serviço e devolve o registro atualizado (dados de
   * exibição, token renovado). Falha transitória → conectado com aviso; recusa → erro com
   * `refusedMessage` (ex.: "reconecte"), mantendo o arquivo.
   */
  async revalidate(
    whoami: (record: TRecord) => Promise<TRecord>,
    refusedMessage: (error: ApiError, record: TRecord) => string
  ): Promise<ConnectionStatus> {
    const loaded = await this.load()
    if (loaded.kind === 'none') return { state: 'disconnected' }
    if (loaded.kind === 'error') return loaded.status
    const { record } = loaded
    let refreshed: TRecord
    try {
      refreshed = await whoami(record)
    } catch (e) {
      if (this.isRefusal(e)) {
        return { state: 'error', message: refusedMessage(e, record), hasStoredCredentials: true }
      }
      return { ...connected(record), warning: this.messageFor(e) }
    }
    try {
      await this.save(refreshed)
    } catch {
      // Falha ao atualizar dados de exibição não invalida a conexão.
    }
    return connected(refreshed)
  }

  /** O serviço recusou a conta/token (não adianta só tentar de novo). */
  isRefusal(e: unknown): e is ApiError {
    return isApiError(e) && !isTransientApiError(e)
  }

  /** Mensagem segura para qualquer erro (a do `ApiError` do serviço, senão a genérica). */
  messageFor(e: unknown): string {
    return isApiError(e) ? e.message : this.messages.unknown
  }

  pastedToken(raw: string): { ok: true; token: string } | { ok: false; status: ConnectionStatus } {
    const token = raw.trim()
    if (token === '') return { ok: false, status: errorStatus(this.messages.emptyToken) }
    if (token.length > this.options.maxTokenLength || /\s/.test(token)) {
      return { ok: false, status: errorStatus(this.messages.malformedToken) }
    }
    // Checa antes de chamar o serviço para não validar um token que não poderemos guardar.
    if (!this.isAvailable()) {
      return { ok: false, status: errorStatus(this.messages.encryptionUnavailable) }
    }
    return { ok: true, token }
  }
}
