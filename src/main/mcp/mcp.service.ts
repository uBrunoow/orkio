/**
 * Fase 4: servidores MCP do Orkio (config) — catálogo curado, cópia dos que o Claude Code do
 * usuário já carrega e os feitos à mão. Todo servidor novo nasce desligado: o comando só roda
 * depois que você liga (e só para os agentes escolhidos). Valores sensíveis nunca ficam na config:
 * são referências ao Vault, liberadas para o servidor (`mcp:<id>`) quando você as escolhe.
 */
import { DomainError } from '../errors'
import type { ConfigStore } from '../storage/config-store'
import type { OrkioConfig } from '../config/orkio-config'
import type { VaultService } from '../vault/vault.service'
import {
  CLAUDE_MCP_MESSAGES,
  copyClaudeServer,
  readClaudeMcp,
  toClaudeEntry,
  type ClaudeMcpFs,
  type ClaudeMcpSources
} from './claude-mcp'
import {
  MCP_LIMITS,
  catalogEntry,
  freeMcpId,
  mcpSecretNames,
  parseMcpServer,
  type ClaudeMcpRef,
  type McpBinding,
  type McpServer,
  type McpServerView,
  type McpView
} from '../../shared/mcp'
import { secretAllows } from '../../shared/vault'

export class McpError extends DomainError {
  constructor(
    code: 'invalid' | 'not_found' | 'limit' | 'read_only' | 'missing_secret' | 'copy',
    message: string
  ) {
    super(code, message)
    this.name = 'McpError'
  }
}

export const MCP_MESSAGES = {
  notFound: 'Esse servidor não existe mais.',
  catalog: 'Item do catálogo desconhecido.',
  limit: `Você chegou ao limite de ${MCP_LIMITS.servers} servidores.`,
  readOnly: 'A configuração está em modo só leitura (aberta por uma versão mais nova do Orkio).',
  invalid: 'Servidor com dados inválidos.',
  newManual: 'Servidor novo só pelo catálogo, pela cópia do Claude Code ou "Adicionar à mão".',
  missingSecret: (label: string) => `Escolha o segredo para "${label}".`,
  unknownSecret: (name: string) => `O segredo ${name} não existe. Crie em Segredos antes.`,
  problemMissing: (name: string) => `Falta o segredo ${name} (crie em Segredos).`,
  problemDenied: (name: string) => `O segredo ${name} não está liberado para este servidor.`
} as const

export interface McpDeps {
  config: Pick<ConfigStore<OrkioConfig>, 'get' | 'update' | 'readOnly'>
  vault: Pick<VaultService, 'meta' | 'grant' | 'revokeUse'>
  claudeSources(): ClaudeMcpSources
  fs?: ClaudeMcpFs
  now?: () => Date
}

export class McpService {
  constructor(private readonly deps: McpDeps) {}

  private servers(): McpServer[] {
    return this.deps.config.get().mcpServers ?? []
  }

  /** O que impede o servidor de carregar agora (sem valores, só nomes). */
  problems(server: McpServer): string[] {
    const out: string[] = []
    for (const name of mcpSecretNames(server)) {
      const meta = this.deps.vault.meta(name)
      if (!meta) out.push(MCP_MESSAGES.problemMissing(name))
      else if (!secretAllows(meta, { kind: 'mcp', id: server.id })) {
        out.push(MCP_MESSAGES.problemDenied(name))
      }
    }
    return out
  }

  async view(): Promise<McpView> {
    const servers: McpServerView[] = this.servers().map((s) => ({
      ...s,
      problems: this.problems(s)
    }))
    const { entries, error } = await readClaudeMcp(this.deps.claudeSources(), this.deps.fs)
    const copied = new Set(
      this.servers().flatMap((s) => (s.origin.kind === 'claude' ? [s.origin.name] : []))
    )
    return {
      servers,
      claude: entries.map((e) => toClaudeEntry(e, copied.has(e.ref.name))),
      claudeError: error
    }
  }

  async addFromCatalog(catalogId: string, secrets: Record<string, string>): Promise<McpView> {
    this.assertWritable()
    const entry = catalogEntry(catalogId)
    if (!entry) throw new McpError('invalid', MCP_MESSAGES.catalog)
    this.assertRoom()
    const env: McpBinding[] = []
    const headers: McpBinding[] = []
    const used: string[] = []
    for (const s of entry.secrets) {
      const name = secrets[s.name]
      if (!name) {
        if (s.required) throw new McpError('missing_secret', MCP_MESSAGES.missingSecret(s.label))
        continue
      }
      if (!this.deps.vault.meta(name)) {
        throw new McpError('missing_secret', MCP_MESSAGES.unknownSecret(name))
      }
      used.push(name)
      const binding: McpBinding = {
        name: s.name,
        value: { kind: 'secret', secret: name, prefix: s.prefix }
      }
      if (s.target === 'env') env.push(binding)
      else headers.push(binding)
    }
    const id = freeMcpId(
      entry.id,
      this.servers().map((x) => x.id)
    )
    const server = parseMcpServer({
      id,
      name: entry.name,
      description: entry.description,
      transport: entry.transport,
      command: entry.command,
      args: entry.args,
      url: entry.url,
      env,
      headers,
      origin: { kind: 'catalog', id: entry.id },
      enabled: false,
      agents: 'all',
      createdAt: this.now()
    })
    if (!server) throw new McpError('invalid', MCP_MESSAGES.invalid)
    await this.write((list) => [...list, server])
    // Escolher o segredo para o servidor é o que libera o uso dele.
    await this.deps.vault.grant(used, { kind: 'mcp', id })
    return this.view()
  }

  async copyFromClaude(ref: ClaudeMcpRef): Promise<McpView> {
    this.assertWritable()
    this.assertRoom()
    const { entries } = await readClaudeMcp(this.deps.claudeSources(), this.deps.fs)
    const raw = entries.find(
      (e) =>
        e.ref.scope === ref.scope && e.ref.name === ref.name && e.ref.projectId === ref.projectId
    )
    if (!raw) throw new McpError('not_found', CLAUDE_MCP_MESSAGES.notFound)
    let server: McpServer
    try {
      server = copyClaudeServer(
        raw,
        this.servers().map((s) => s.id),
        this.now()
      )
    } catch (error) {
      // Mensagens fixas do copiador (nunca texto do arquivo).
      const known = Object.values(CLAUDE_MCP_MESSAGES) as string[]
      const message =
        error instanceof Error && known.includes(error.message)
          ? error.message
          : CLAUDE_MCP_MESSAGES.unsupported
      throw new McpError('copy', message)
    }
    await this.write((list) => [...list, server])
    return this.view()
  }

  /**
   * Cria (só `origin: manual`) ou troca um servidor. A origem e a data do existente não mudam pelo
   * renderer. Segredos referenciados que existem ficam liberados para o servidor.
   */
  async save(input: McpServer): Promise<McpView> {
    this.assertWritable()
    const parsed = parseMcpServer(input)
    if (!parsed) throw new McpError('invalid', MCP_MESSAGES.invalid)
    const existing = this.servers().find((s) => s.id === parsed.id)
    let server: McpServer
    if (existing) {
      server = { ...parsed, origin: existing.origin, createdAt: existing.createdAt }
    } else {
      if (parsed.origin.kind !== 'manual') throw new McpError('invalid', MCP_MESSAGES.newManual)
      this.assertRoom()
      server = { ...parsed, createdAt: this.now() }
    }
    for (const name of mcpSecretNames(server)) {
      if (!this.deps.vault.meta(name)) {
        throw new McpError('missing_secret', MCP_MESSAGES.unknownSecret(name))
      }
    }
    await this.write((list) =>
      existing ? list.map((s) => (s.id === server.id ? server : s)) : [...list, server]
    )
    await this.deps.vault.grant(mcpSecretNames(server), { kind: 'mcp', id: server.id })
    return this.view()
  }

  async remove(id: string): Promise<McpView> {
    this.assertWritable()
    if (!this.servers().some((s) => s.id === id))
      throw new McpError('not_found', MCP_MESSAGES.notFound)
    await this.write((list) => list.filter((s) => s.id !== id))
    await this.deps.vault.revokeUse({ kind: 'mcp', id })
    return this.view()
  }

  private async write(change: (list: McpServer[]) => McpServer[]): Promise<void> {
    await this.deps.config.update((c) => {
      const mcpServers = change(c.mcpServers ?? [])
      const next: OrkioConfig = { ...c, mcpServers }
      if (mcpServers.length === 0) delete next.mcpServers
      return next
    })
  }

  private assertWritable(): void {
    if (this.deps.config.readOnly) throw new McpError('read_only', MCP_MESSAGES.readOnly)
  }

  private assertRoom(): void {
    if (this.servers().length >= MCP_LIMITS.servers) throw new McpError('limit', MCP_MESSAGES.limit)
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}
