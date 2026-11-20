import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'

export const ROOT = resolve(__dirname, '..')
/** Mesmo valor de .env.e2e (o build de E2E usa --mode e2e). */
export const E2E_BROKER_URL = 'https://orkio-oauth-broker.e2e.invalid'

/**
 * Simulação dos serviços externos, dentro do processo main:
 * - `notion`: resposta de GET /v1/users/me ('ok' | '401' | '503'). Em 'ok', só aceita os
 *   tokens listados em `validTokens` (se houver) — o resto recebe 401.
 * - `browser`: o que o "usuário" faz na página de autorização do Notion.
 * - `broker`: resposta do intermediário OAuth.
 */
export interface FakeServices {
  notion: 'ok' | '401' | '503'
  validTokens: string[] | null
  browser: 'approve' | 'deny' | 'ignore'
  broker: 'ok' | 'invalid_grant' | 'down'
  /** GitHub Device Flow: o que o "usuário" faz em github.com/login/device. */
  githubDevice: 'approve' | 'pending' | 'deny' | 'expire'
  /** GET api.github.com/user. */
  githubUser: 'ok' | '401' | 'rate_limited'
  /** GET api.github.com/repos/{owner}/{repo}, por "owner/repo" (minúsculas). Padrão: 'ok'. */
  githubRepos: Record<string, 'ok' | 'not_found' | 'sso' | 'restricted' | 'archived'>
  /**
   * Bancos simulados do Notion (search, data_sources, query). Variações do banco de Tarefas:
   * sem propriedade de ID, Status renomeado ou Status apagado.
   */
  notionTasks: 'ok' | 'no_unique_id' | 'renamed' | 'status_deleted'
  /** Rede até api.notion.com (bancos/tarefas/escritas): 'down' simula sem internet. */
  notionNetwork: 'up' | 'down'
  /** PATCH de páginas: 'ok' aplica no estado simulado; 'reject' devolve 400. */
  notionWrites: 'ok' | 'reject'
  /** Status inicial por página (para "o Notion continua igual" entre aberturas do app). */
  notionInitialStatus: Record<string, string>
  /** Branches remotas (GET /repos/{o}/{r}/branches), iguais para todo repositório. */
  githubBranches: string[]
  /** PRs (GET /repos/{o}/{r}/pulls). `updatedDaysAgo` padrão: 1. */
  githubPulls: FakePull[]
  /** Detalhes via GraphQL por número da PR. */
  githubPrDetails: Record<
    string,
    {
      reviewDecision: string | null
      unresolved: number
      checks: string | null
      /** 3B: reviews com decisão e pedidos de review (ids estáveis). */
      reviews?: { id: string; state: 'APPROVED' | 'CHANGES_REQUESTED'; submittedAt: string }[]
      reviewRequests?: { id: string; createdAt: string }[]
    }
  >
}

export interface FakePull {
  number: number
  title: string
  head: string
  state: 'open' | 'draft' | 'merged' | 'closed'
  updatedDaysAgo?: number
  /** `updated_at` exato (o GitHub muda a cada review/pedido; o Orkio relê os detalhes). */
  updatedAt?: string
}

/** Ids fixos dos bancos e páginas simulados (formato de id do Notion). */
export const NOTION_FAKE = {
  projectsDs: '11111111-1111-4111-8111-111111111111',
  tasksDs: '22222222-2222-4222-8222-222222222222',
  meetingsDs: '33333333-3333-4333-8333-333333333333',
  orkioPage: 'aaaaaaaa-0000-4000-8000-000000000001',
  sitePage: 'aaaaaaaa-0000-4000-8000-000000000002'
} as const

export const DEFAULT_FAKES: FakeServices = {
  notion: 'ok',
  validTokens: null,
  browser: 'approve',
  broker: 'ok',
  githubDevice: 'approve',
  githubUser: 'ok',
  githubRepos: {},
  notionTasks: 'ok',
  notionNetwork: 'up',
  notionWrites: 'ok',
  notionInitialStatus: {},
  githubBranches: [],
  githubPulls: [],
  githubPrDetails: {}
}

interface FakeGlobals {
  __fakes: FakeServices
  /** Próximas pastas "escolhidas" no seletor do sistema (vazio = cancelar). */
  __picks: string[]
  /** Próximos caminhos escolhidos em "Salvar como…" (vazio = cancelar). */
  __savePaths: string[]
  __calls: {
    url: string
    auth: string | undefined
    version: string | undefined
    body?: string
    ifNoneMatch?: string
    status?: number
  }[]
  __opened: string[]
  __tokenSeq: number
  /** Estado mutável do Notion simulado (status por página, checkbox/select extras, schema). */
  __notion: {
    status: Record<string, string>
    extra: Record<string, Record<string, unknown>>
    addedProperties: Record<string, unknown>
  }
}

const TASK_PAGE = (n: number): string => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
export const NOTION_TASK_IDS = { ork1: TASK_PAGE(1), ork2: TASK_PAGE(2), ork3: TASK_PAGE(3) }

/** Muda o Notion simulado "por fora" (como se alguém editasse no Notion). */
export async function setNotionStatus(
  app: ElectronApplication,
  pageId: string,
  status: string
): Promise<void> {
  await app.evaluate(
    (_e, [id, value]) => {
      ;(globalThis as unknown as FakeGlobals).__notion.status[id] = value
    },
    [pageId, status] as const
  )
}

export async function notionState(app: ElectronApplication): Promise<FakeGlobals['__notion']> {
  return app.evaluate(() => (globalThis as unknown as FakeGlobals).__notion)
}

export interface OrkioApp {
  app: ElectronApplication
  page: Page
  /** stdout/stderr do processo e console do renderer. */
  logs: string[]
}

export function createUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'orkio-e2e-'))
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  rmSync(`${dir}-bin`, { recursive: true, force: true })
  rmSync(`${dir}-home`, { recursive: true, force: true })
}

/**
 * Abre o app (out/) com um userData isolado e substitui, no processo main, `fetch` e
 * `shell.openExternal` pelos simuladores acima. O código do app não tem modo de teste.
 * No Linux sem keyring, liga a criptografia básica do Electron só para o teste.
 */
export async function launchOrkio(
  userDataDir: string,
  fakes: Partial<FakeServices> = {},
  options: {
    startPage?: 'projects' | 'integrations'
    /** Claude Code simulado: `installed: false` tira o CLI do PATH. */
    claude?: { loggedIn?: boolean; installed?: boolean }
  } = {}
): Promise<OrkioApp> {
  const env = { ...process.env } as Record<string, string>
  // Opções do Node que o Electron rejeita (ex.: --use-openssl-ca) poluem o log.
  delete env['NODE_OPTIONS']
  // Claude Code SIMULADO sempre primeiro no PATH: o E2E nunca chama o CLI real (4A).
  const fakeBin = fakeClaudeBin(userDataDir, options.claude ?? { loggedIn: true })
  env['PATH'] = `${fakeBin}${delimiter}${env['PATH'] ?? ''}`
  // HOME isolado: o catálogo de comandos nunca lê o ~/.claude de verdade no E2E.
  const home = `${userDataDir}-home`
  mkdirSync(join(home, '.claude', 'commands'), { recursive: true })
  writeFileSync(
    join(home, '.claude', 'commands', 'revisar.md'),
    '---\nname: revisar\ndescription: Revisa o diff da tarefa\n---\nCORPO'
  )
  env['HOME'] = home
  env['USERPROFILE'] = home
  // Chave "vazada" no ambiente: o Orkio precisa filtrá-la antes de abrir o CLI.
  env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-E2E-NAO-PODE-VAZAR'

  const args = ['.', `--user-data-dir=${userDataDir}`]
  // Chromium não roda como root sem --no-sandbox (containers de CI).
  if (process.getuid?.() === 0) args.push('--no-sandbox')

  const app = await electron.launch({ args, cwd: ROOT, env })
  const logs: string[] = []
  app.process().stdout?.on('data', (d: Buffer) => logs.push(String(d)))
  app.process().stderr?.on('data', (d: Buffer) => logs.push(String(d)))

  await app.evaluate(
    ({ safeStorage, shell, dialog }, { initial, brokerUrl, ids }) => {
      const g = globalThis as unknown as FakeGlobals
      if (process.platform === 'linux' && !safeStorage.isEncryptionAvailable()) {
        safeStorage.setUsePlainTextEncryption(true)
        safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'
      }
      g.__fakes = initial
      g.__picks = []
      g.__savePaths = []
      dialog.showSaveDialog = (async () => {
        const next = g.__savePaths.shift()
        return next ? { canceled: false, filePath: next } : { canceled: true, filePath: '' }
      }) as typeof dialog.showSaveDialog
      // Seletor de pasta do sistema → fila controlada pelo teste.
      dialog.showOpenDialog = (async () => {
        const next = g.__picks.shift()
        return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] }
      }) as typeof dialog.showOpenDialog
      g.__calls = []
      g.__opened = []
      g.__tokenSeq = 0
      g.__notion = {
        status: {
          [`bbbbbbbb-0000-4000-8000-${'1'.padStart(12, '0')}`]: 'Concluída',
          [`bbbbbbbb-0000-4000-8000-${'2'.padStart(12, '0')}`]: 'Em andamento',
          [`bbbbbbbb-0000-4000-8000-${'3'.padStart(12, '0')}`]: 'A fazer',
          ...initial.notionInitialStatus
        },
        extra: {},
        addedProperties: {}
      }
      const realFetch = globalThis.fetch
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status })

      // "Navegador": registra a URL e, para a página de autorização do Notion, simula o usuário.
      shell.openExternal = async (url: string) => {
        g.__opened.push(url)
        const parsed = new URL(url)
        if (parsed.origin + parsed.pathname !== 'https://api.notion.com/v1/oauth/authorize') return
        const redirect = new URL(parsed.searchParams.get('redirect_uri') ?? '')
        redirect.searchParams.set('state', parsed.searchParams.get('state') ?? '')
        if (g.__fakes.browser === 'ignore') return
        if (g.__fakes.browser === 'deny') redirect.searchParams.set('error', 'access_denied')
        else redirect.searchParams.set('code', 'e2e-auth-code')
        // Redirect de verdade para o servidor local do app.
        setTimeout(() => void realFetch(redirect.toString()).catch(() => {}), 50)
      }

      globalThis.fetch = async (input, init) => {
        const url = String(input)
        const headers = (init?.headers ?? {}) as Record<string, string>
        const call = {
          url,
          auth: headers['Authorization'],
          version: headers['Notion-Version'] ?? headers['X-GitHub-Api-Version'],
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
          ...(headers['If-None-Match'] ? { ifNoneMatch: headers['If-None-Match'] } : {})
        } as FakeGlobals['__calls'][number]
        g.__calls.push(call)

        // Intermediário OAuth.
        if (url.startsWith(brokerUrl)) {
          if (g.__fakes.broker === 'down') throw new TypeError('fetch failed')
          if (g.__fakes.broker === 'invalid_grant') return json({ error: 'invalid_grant' }, 400)
          // Geração do token: na renovação, a seguinte à do refresh token recebido.
          const previous = /nrt_E2E_OAUTH_REFRESH_(\d+)/.exec(call.body ?? '')
          g.__tokenSeq = previous ? Number(previous[1]) + 1 : g.__tokenSeq + 1
          return json({
            access_token: `ntn_E2E_OAUTH_ACCESS_${g.__tokenSeq}`,
            token_type: 'bearer',
            refresh_token: `nrt_E2E_OAUTH_REFRESH_${g.__tokenSeq}`,
            bot_id: 'bot-e2e',
            workspace_id: 'ws-e2e',
            workspace_name: 'Acme Labs',
            workspace_icon: null,
            owner: { type: 'user', user: { id: 'u1', name: 'Grace Hopper', avatar_url: null } }
          })
        }

        // GitHub: Device Flow (github.com) e API REST (api.github.com).
        if (url === 'https://github.com/login/device/code') {
          return json({
            device_code: 'e2e-device-code',
            user_code: 'WDJB-MJHT',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 1
          })
        }
        if (url === 'https://github.com/login/oauth/access_token') {
          const mode = g.__fakes.githubDevice
          if (mode === 'pending') return json({ error: 'authorization_pending' })
          if (mode === 'deny') return json({ error: 'access_denied' })
          if (mode === 'expire') return json({ error: 'expired_token' })
          return json({ access_token: 'gho_E2E_DEVICE_TOKEN', token_type: 'bearer', scope: 'repo' })
        }
        // Sinais (2D): branches e PRs com ETag; detalhes via GraphQL.
        const listMatch =
          /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/(branches|pulls)\?(.*)$/.exec(url)
        if (listMatch) {
          const owner = decodeURIComponent(listMatch[1]!)
          const name = decodeURIComponent(listMatch[2]!)
          const mode = g.__fakes.githubRepos[`${owner}/${name}`.toLowerCase()] ?? 'ok'
          if (mode === 'not_found') return json({ message: 'Not Found' }, 404)
          const params = new URLSearchParams(listMatch[4])
          let body: unknown[]
          if (listMatch[3] === 'branches') {
            body = g.__fakes.githubBranches.map((b) => ({ name: b, commit: { sha: 'abc' } }))
          } else {
            const wantOpen = params.get('state') === 'open'
            body = g.__fakes.githubPulls
              .filter((p) => (p.state === 'open' || p.state === 'draft') === wantOpen)
              .map((p) => ({
                number: p.number,
                title: p.title,
                html_url: `https://github.com/${owner}/${name}/pull/${p.number}`,
                state: p.state === 'open' || p.state === 'draft' ? 'open' : 'closed',
                draft: p.state === 'draft',
                merged_at: p.state === 'merged' ? '2026-01-01T00:00:00Z' : null,
                updated_at:
                  p.updatedAt ??
                  new Date(Date.now() - (p.updatedDaysAgo ?? 1) * 86_400_000)
                    .toISOString()
                    .slice(0, 10),
                closed_at:
                  p.state === 'merged' || p.state === 'closed' ? '2026-01-01T00:00:00Z' : null,
                head: { ref: p.head }
              }))
          }
          const etag = `W/"${JSON.stringify(body).length}-${JSON.stringify(body)
            .split('')
            .reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)}"`
          if (headers['If-None-Match'] === etag) {
            call.status = 304
            return new Response(null, { status: 304, headers: { etag } })
          }
          call.status = 200
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json', etag }
          })
        }
        if (url === 'https://api.github.com/graphql') {
          const query = String((JSON.parse(call.body ?? '{}') as { query?: string }).query)
          const repository: Record<string, unknown> = {}
          for (const match of query.matchAll(/pr(\d+): pullRequest/g)) {
            const d = g.__fakes.githubPrDetails[match[1]!]
            repository[`pr${match[1]}`] = d
              ? {
                  number: Number(match[1]),
                  reviewDecision: d.reviewDecision,
                  reviewThreads: {
                    nodes: [
                      ...Array.from({ length: d.unresolved }, (_, i) => ({
                        id: `thread-${match[1]}-${i}`,
                        isResolved: false
                      })),
                      { id: `thread-${match[1]}-resolved`, isResolved: true }
                    ]
                  },
                  timelineItems: { nodes: d.reviewRequests ?? [] },
                  reviews: { nodes: d.reviews ?? [] },
                  commits: {
                    nodes: [
                      { commit: { statusCheckRollup: d.checks ? { state: d.checks } : null } }
                    ]
                  }
                }
              : null
          }
          return json({ data: { repository } })
        }

        const repoMatch = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/?]+)$/.exec(url)
        if (repoMatch) {
          const owner = decodeURIComponent(repoMatch[1]!)
          const name = decodeURIComponent(repoMatch[2]!)
          const mode = g.__fakes.githubRepos[`${owner}/${name}`.toLowerCase()] ?? 'ok'
          if (mode === 'not_found') return json({ message: 'Not Found' }, 404)
          if (mode === 'sso') {
            return new Response(JSON.stringify({ message: 'Resource protected by SAML.' }), {
              status: 403,
              headers: {
                'X-GitHub-SSO': `required; url=https://github.com/orgs/${owner}/sso?authorization_request=E2E`
              }
            })
          }
          if (mode === 'restricted') {
            return json(
              {
                message: `Although you appear to have the correct authorization credentials, the \`${owner}\` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.`
              },
              403
            )
          }
          return json({
            name,
            owner: { login: owner },
            default_branch: 'main',
            visibility: 'private',
            private: true,
            archived: mode === 'archived',
            permissions: { admin: false, maintain: false, push: true, triage: true, pull: true }
          })
        }

        if (url === 'https://api.github.com/user') {
          const mode = g.__fakes.githubUser
          if (mode === '401') return json({ message: 'Bad credentials' }, 401)
          if (mode === 'rate_limited') {
            return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
              status: 403,
              headers: {
                'x-ratelimit-remaining': '0',
                'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800)
              }
            })
          }
          return new Response(
            JSON.stringify({
              login: 'octocat',
              id: 1,
              name: 'The Octocat',
              avatar_url: null
            }),
            { status: 200, headers: { 'X-OAuth-Scopes': 'repo' } }
          )
        }

        // API do Notion.
        if (url === 'https://api.notion.com/v1/users/me') {
          const token = (headers['Authorization'] ?? '').replace(/^Bearer /, '')
          const { notion, validTokens } = g.__fakes
          if (notion === '503') return new Response('indisponível', { status: 503 })
          if (notion === '401' || (validTokens && !validTokens.includes(token))) {
            return json({ object: 'error', code: 'unauthorized' }, 401)
          }
          if (token.startsWith('ntn_E2E_OAUTH_')) {
            return json({
              object: 'user',
              id: 'bot-e2e',
              type: 'bot',
              name: 'Orkio',
              avatar_url: null,
              bot: {
                owner: { type: 'user', user: { name: 'Grace Hopper', avatar_url: null } },
                workspace_name: 'Acme Labs'
              }
            })
          }
          return json({ object: 'user', id: 'u1', type: 'person', name: 'Ada Lovelace' })
        }

        // Bancos do Notion (data sources). Exige um token aceito em /users/me.
        if (url.startsWith('https://api.notion.com/v1/')) {
          const token = (headers['Authorization'] ?? '').replace(/^Bearer /, '')
          const { notion, validTokens, notionTasks } = g.__fakes
          if (notion === '401' || !token || (validTokens && !validTokens.includes(token))) {
            return json({ object: 'error', code: 'unauthorized' }, 401)
          }
          if (g.__fakes.notionNetwork === 'down') throw new TypeError('fetch failed')
          const rich = (text: string): unknown[] => [{ type: 'text', plain_text: text }]
          const path = url.slice('https://api.notion.com/v1'.length)
          const body = call.body ? (JSON.parse(call.body) as Record<string, unknown>) : {}
          const STATUS_OPTIONS = [
            { id: 'o1', name: 'A fazer', color: 'gray' },
            { id: 'o4', name: 'Prioridades', color: 'orange' },
            { id: 'o2', name: 'Em andamento', color: 'blue' },
            { id: 'o5', name: 'Finalizadas', color: 'green' },
            { id: 'o3', name: 'Concluída', color: 'green' }
          ]

          // Escrita numa página (3A).
          const pagePatch = /^\/pages\/([0-9a-f-]+)$/.exec(path)
          if (pagePatch && init?.method === 'PATCH') {
            if (g.__fakes.notionWrites === 'reject') {
              return json({ object: 'error', code: 'validation_error', message: 'x' }, 400)
            }
            const pageId = pagePatch[1]!
            const props = (body['properties'] ?? {}) as Record<string, Record<string, unknown>>
            for (const [propId, value] of Object.entries(props)) {
              const status = value['status'] as { name?: string } | undefined
              if (propId === 'st%3A' && status?.name) {
                if (!STATUS_OPTIONS.some((o) => o.name === status.name)) {
                  return json({ object: 'error', code: 'validation_error' }, 400)
                }
                g.__notion.status[pageId] = status.name
              } else {
                g.__notion.extra[pageId] ??= {}
                g.__notion.extra[pageId][propId] = value
              }
            }
            return json({ object: 'page', id: pageId })
          }
          // Nova propriedade no data source de Tarefas (3A: "Etapa Orkio").
          if (path === `/data_sources/${ids.tasksDs}` && init?.method === 'PATCH') {
            const props = (body['properties'] ?? {}) as Record<string, Record<string, unknown>>
            const result: Record<string, unknown> = {}
            for (const [name, value] of Object.entries(props)) {
              const select = value['select'] as { options: { name: string; color?: string }[] }
              const prop = {
                id: `added-${Object.keys(g.__notion.addedProperties).length + 1}`,
                name,
                type: 'select',
                select: {
                  options: select.options.map((o, i) => ({
                    id: `opt-${i}`,
                    name: o.name,
                    color: o.color ?? 'default'
                  }))
                }
              }
              g.__notion.addedProperties[name] = prop
              result[name] = prop
            }
            return json({ object: 'data_source', id: ids.tasksDs, properties: result })
          }

          if (path === '/search') {
            const all = [
              { id: ids.projectsDs, title: 'Projetos' },
              { id: ids.tasksDs, title: 'Tarefas' },
              { id: ids.meetingsDs, title: 'Reuniões' }
            ]
            const query = typeof body['query'] === 'string' ? body['query'].toLowerCase() : ''
            return json({
              object: 'list',
              results: all
                .filter((d) => d.title.toLowerCase().includes(query))
                .map((d) => ({
                  object: 'data_source',
                  id: d.id,
                  title: rich(d.title),
                  url: `https://www.notion.so/${d.id.replace(/-/g, '')}`
                })),
              has_more: false,
              next_cursor: null
            })
          }

          const statusProperty = {
            id: 'st%3A',
            name: notionTasks === 'renamed' ? 'Etapa' : 'Status',
            type: 'status',
            status: { options: STATUS_OPTIONS }
          }
          const tasksProperties: Record<string, unknown> = {
            Nome: { id: 'title', name: 'Nome', type: 'title', title: {} },
            ...(notionTasks === 'status_deleted' ? {} : { [statusProperty.name]: statusProperty }),
            ...(notionTasks === 'no_unique_id'
              ? {}
              : { ID: { id: 'uid', name: 'ID', type: 'unique_id', unique_id: { prefix: 'ORK' } } }),
            Projeto: {
              id: 'rel',
              name: 'Projeto',
              type: 'relation',
              relation: { data_source_id: ids.projectsDs, type: 'dual_property' }
            },
            Prioridade: {
              id: 'pri',
              name: 'Prioridade',
              type: 'select',
              select: { options: [{ id: 'p1', name: 'Alta', color: 'red' }] }
            },
            Responsável: { id: 'ppl', name: 'Responsável', type: 'people', people: {} },
            Bloqueada: { id: 'blk', name: 'Bloqueada', type: 'checkbox', checkbox: {} },
            ...g.__notion.addedProperties
          }

          if (path === `/data_sources/${ids.projectsDs}`) {
            return json({
              object: 'data_source',
              id: ids.projectsDs,
              title: rich('Projetos'),
              properties: { Nome: { id: 'title', name: 'Nome', type: 'title', title: {} } }
            })
          }
          if (path === `/data_sources/${ids.tasksDs}`) {
            return json({
              object: 'data_source',
              id: ids.tasksDs,
              title: rich('Tarefas'),
              properties: tasksProperties
            })
          }
          if (path === `/data_sources/${ids.projectsDs}/query`) {
            const page = (id: string, title: string): unknown => ({
              object: 'page',
              id,
              url: `https://www.notion.so/${id.replace(/-/g, '')}`,
              properties: { Nome: { id: 'title', type: 'title', title: rich(title) } }
            })
            return json({
              object: 'list',
              results: [
                page(ids.sitePage, 'Site institucional'),
                page(ids.orkioPage, 'Orkio Desktop')
              ],
              has_more: false,
              next_cursor: null
            })
          }
          // Conteúdo da página da tarefa (4A: briefing).
          const children = /^\/blocks\/([0-9a-f-]+)\/children/.exec(path)
          if (children) {
            const para = (text: string): unknown => ({
              type: 'paragraph',
              paragraph: { rich_text: rich(text) }
            })
            const blocks =
              children[1] === 'cccccccc-0000-4000-8000-000000000001'
                ? [para('Detalhe aninhado')]
                : [
                    para('Exportar as tarefas em CSV.'),
                    {
                      type: 'heading_2',
                      heading_2: { rich_text: rich('Critérios de aceite') }
                    },
                    {
                      id: 'cccccccc-0000-4000-8000-000000000001',
                      type: 'bulleted_list_item',
                      has_children: true,
                      bulleted_list_item: { rich_text: rich('Gera um arquivo .csv') }
                    },
                    { type: 'audio', audio: {} }
                  ]
            return json({ object: 'list', results: blocks, next_cursor: null, has_more: false })
          }

          if (path === `/data_sources/${ids.tasksDs}/query`) {
            const filter = body['filter'] as
              { property?: string; relation?: { contains?: string } } | undefined
            const target = filter?.relation?.contains
            const task = (
              n: number,
              title: string,
              project: string,
              _initial: { name: string; color: string },
              priority: boolean
            ): unknown => {
              const id = `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
              const name = g.__notion.status[id] ?? _initial.name
              const option = STATUS_OPTIONS.find((o) => o.name === name)
              const extras: Record<string, unknown> = {}
              for (const [propId, value] of Object.entries(g.__notion.extra[id] ?? {})) {
                const v = value as { checkbox?: boolean; select?: { name: string } }
                extras[`extra-${propId}`] =
                  typeof v.checkbox === 'boolean'
                    ? { id: propId, type: 'checkbox', checkbox: v.checkbox }
                    : { id: propId, type: 'select', select: v.select ?? null }
              }
              return {
                object: 'page',
                id: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`,
                url: `https://www.notion.so/ORK-${n}-bbbb${n}`,
                properties: {
                  Nome: { id: 'title', type: 'title', title: rich(title) },
                  Status: {
                    id: 'st%3A',
                    type: 'status',
                    status: option
                      ? { id: option.id, name: option.name, color: option.color }
                      : null
                  },
                  ID: { id: 'uid', type: 'unique_id', unique_id: { prefix: 'ORK', number: n } },
                  Projeto: { id: 'rel', type: 'relation', relation: [{ id: project }] },
                  Prioridade: {
                    id: 'pri',
                    type: 'select',
                    select: priority ? { name: 'Alta', color: 'red' } : null
                  },
                  Bloqueada: { id: 'blk', type: 'checkbox', checkbox: false },
                  ...extras
                }
              }
            }
            const all = [
              task(
                2,
                'Listar tarefas do Notion',
                ids.orkioPage,
                { name: 'Em andamento', color: 'blue' },
                true
              ),
              task(
                1,
                'Conectar o Notion via OAuth',
                ids.orkioPage,
                { name: 'Concluída', color: 'green' },
                false
              ),
              task(3, 'Nova home do site', ids.sitePage, { name: 'A fazer', color: 'gray' }, false)
            ]
            return json({
              object: 'list',
              results:
                filter?.property === 'rel' && target
                  ? all.filter(
                      (t) =>
                        (t as { properties: { Projeto: { relation: { id: string }[] } } })
                          .properties.Projeto.relation[0]?.id === target
                    )
                  : all,
              has_more: false,
              next_cursor: null
            })
          }
        }

        return json({ object: 'error', code: 'not_found' }, 404)
      }
    },
    { initial: { ...DEFAULT_FAKES, ...fakes }, brokerUrl: E2E_BROKER_URL, ids: NOTION_FAKE }
  )

  const page = await app.firstWindow()
  page.on('console', (m) => logs.push(m.text()))
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber} ${e.sample}`
      )
    )
  })
  await page.setViewportSize({ width: 1100, height: 720 })
  // Recarrega para que o status inicial já passe pelos simuladores acima.
  await page.reload()
  // O app abre em Projetos; os specs de integrações começam em Integrações.
  // Tela inicial: "Começar" leva a Projetos (como era a tela de abertura antes dela).
  await page.getByRole('button', { name: 'Começar', exact: true }).click()
  if ((options.startPage ?? 'integrations') === 'integrations') {
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Integrações' })
      .click()
  }
  return { app, page, logs }
}

export async function setFakes(
  app: ElectronApplication,
  fakes: Partial<FakeServices>
): Promise<void> {
  await app.evaluate((_electron, next) => {
    const g = globalThis as unknown as FakeGlobals
    g.__fakes = { ...g.__fakes, ...next }
  }, fakes)
}

export async function externalCalls(app: ElectronApplication): Promise<FakeGlobals['__calls']> {
  return app.evaluate(() => (globalThis as unknown as FakeGlobals).__calls)
}

export async function openedUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as FakeGlobals).__opened)
}

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
}

/** Cards da tela de Integrações (cada <section> nomeada vira uma região acessível). */
export function notionCard(page: Page): Locator {
  return page.getByRole('region', { name: 'Notion', exact: true })
}

export function githubCard(page: Page): Locator {
  return page.getByRole('region', { name: 'GitHub' })
}

/** Enfileira pastas para as próximas aberturas do seletor de pasta (no main). */
export async function queueFolderPicks(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate((_electron, next) => {
    ;(globalThis as unknown as FakeGlobals).__picks.push(...next)
  }, paths)
}

/**
 * Alertas visíveis do app. Ignora a região `aria-live` global da Astryx (sempre presente,
 * vazia e escondida), que também tem role="alert".
 */
export function alerts(scope: Page | Locator): Locator {
  return scope.locator('[role="alert"]:not([data-astryx-live-region])')
}

/** Enfileira caminhos para as próximas aberturas de "Salvar como…" (no main). */
export async function queueSavePaths(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate((_electron, next) => {
    ;(globalThis as unknown as FakeGlobals).__savePaths.push(...next)
  }, paths)
}

/** Pasta com o `claude` simulado (e2e/fake-claude) e o estado de login dele. */
function fakeClaudeBin(
  userDataDir: string,
  claude: { loggedIn?: boolean; installed?: boolean }
): string {
  const dir = `${userDataDir}-bin`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  if (claude.installed !== false) {
    copyFileSync(join(ROOT, 'e2e', 'fake-claude', 'claude'), join(dir, 'claude'))
    chmodSync(join(dir, 'claude'), 0o755)
    writeFileSync(
      join(dir, 'auth.json'),
      JSON.stringify(
        claude.loggedIn === false
          ? { loggedIn: false, authMethod: 'none' }
          : { loggedIn: true, authMethod: 'claude.ai' }
      )
    )
  }
  return dir
}
