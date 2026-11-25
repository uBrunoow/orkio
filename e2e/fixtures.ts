import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { isInstallUrl } from '../src/shared/github-names'
import { REVIEW_APPLY_PROMPT, REVIEW_JSON_PROMPT } from '../src/shared/alva-templates'

export const ROOT = resolve(__dirname, '..')
/** Endereço do site no build de E2E (`MAIN_VITE_SITE_URL` do `.env.e2e`; `--mode e2e`). */
export const E2E_SITE_URL = (() => {
  const line = /^MAIN_VITE_SITE_URL=(.+)$/m.exec(readFileSync(join(ROOT, '.env.e2e'), 'utf8'))
  if (!line) throw new Error('.env.e2e sem MAIN_VITE_SITE_URL')
  return line[1]!.trim()
})()
/** Link de instalação do App que o site simulado devolve: no formato que o app aceita. */
const E2E_INSTALL_URL = 'https://github.com/apps/orkio/installations/new'
if (!isInstallUrl(E2E_INSTALL_URL)) throw new Error('E2E_INSTALL_URL fora do formato do app')

/**
 * Simulação dos serviços externos, dentro do processo main:
 * - `notion`: resposta de GET /v1/users/me ('ok' | '401' | '503'). Em 'ok', só aceita os
 *   tokens listados em `validTokens` (se houver) — o resto recebe 401.
 * - `browser`: o que o "usuário" faz na página de autorização do Notion.
 * - `notionOAuth`: resposta do intermediário OAuth do Notion (`<site>/notion/*`).
 */
export interface FakeServices {
  notion: 'ok' | '401' | '503'
  validTokens: string[] | null
  browser: 'approve' | 'deny' | 'ignore'
  notionOAuth: 'ok' | 'invalid_grant' | 'down'
  /**
   * 6A: base de um site DE VERDADE (o site local, `next start`). Com ela, as chamadas do app ao
   * site do build E2E (`/notion/*`, `/github/*`) vão por HTTP real para lá, em vez da simulação.
   */
  siteTarget: string | null
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
  /** Task 18: arquivos da PR (`GET /pulls/{n}/files`), por número: `filename` + `patch`. */
  githubPrFiles?: Record<string, { filename: string; patch?: string }[]>
  /** Repositórios (`owner/repo`) com o orkio[bot] instalado (`POST <site>/github/installation`). */
  orkioBotInstalled?: string[]
  /**
   * Fase 0: resposta do `GET api.anthropic.com/api/oauth/usage` (medidor de uso do Claude) para o
   * token `CLAUDE_USAGE_TOKEN`; ausente = 404 (o medidor some).
   */
  claudeUsage?: unknown
  /** 'no_scope': todo GraphQL falha com INSUFFICIENT_SCOPES (`data: null`), como um token sem permissão. */
  githubGraphql?: 'ok' | 'no_scope'
  /** Detalhes via GraphQL por número da PR. */
  githubPrDetails: Record<
    string,
    {
      reviewDecision: string | null
      unresolved: number
      checks: string | null
      /** Cartão da PR: tamanho (GraphQL). */
      additions?: number
      deletions?: number
      changedFiles?: number
      /** 3B: reviews com decisão e pedidos de review (ids estáveis). 5C: autores/revisores. */
      reviews?: {
        id: string
        state: 'APPROVED' | 'CHANGES_REQUESTED'
        submittedAt: string
        author?: { login: string }
      }[]
      reviewRequests?: { id: string; createdAt: string; requestedReviewer?: { login: string } }[]
      /** Task 15: threads com texto (query `pullRequest(number: $number)` do Orkio). */
      threads?: {
        id: string
        isResolved: boolean
        isOutdated?: boolean
        path: string | null
        line: number | null
        comments: { author: string; body: string; createdAt: string; url: string }[]
      }[]
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
  /** 5C: commit no topo da branch da PR (`head.sha`). */
  sha?: string
  /** Cartão da PR: quem abriu (`user.login`) e quando (`created_at`). */
  author?: string
  createdAt?: string
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
  notionOAuth: 'ok',
  siteTarget: null,
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
    /** 5C: pedidos de review recebidos (POST requested_reviewers). */
    reviewRequests?: { pull: number; reviewers: string[]; teams: string[] }[]
    /**
     * Task 18: revisões que o app mandou ao site do Orkio (`POST <site>/github/review`). O token do
     * usuário não é guardado; só se veio.
     */
    siteReviews?: {
      owner: string
      repo: string
      number: number
      hasUserToken: boolean
      review: {
        event: string
        body: string
        comments?: { path: string; line: number; side: string; body: string }[]
      }
    }[]
    /** Publicações de artefatos (4B): subpáginas criadas e markdown acrescentado. */
    published: {
      kind: 'child_page' | 'section'
      parent: string
      title?: string
      markdown: string
    }[]
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

/** Mapeamento das propriedades do Notion simulado (ids das propriedades de `NOTION_FAKE.tasksDs`). */
export const NOTION_MAPPING = {
  title: { id: 'title', name: 'Nome', type: 'title' },
  status: { id: 'st%3A', name: 'Status', type: 'status' },
  uniqueId: { id: 'uid', name: 'ID', type: 'unique_id' },
  project: { id: 'rel', name: 'Projeto', type: 'relation' },
  priority: { id: 'pri', name: 'Prioridade', type: 'select' },
  assignee: { id: 'ppl', name: 'Responsável', type: 'people' }
} as const

/** Repositório `acme/orkio-app` do GitHub simulado, como o Orkio grava no projeto. */
export const FAKE_REPO = {
  host: 'github.com',
  owner: 'acme',
  name: 'orkio-app',
  remoteName: 'origin',
  defaultBranch: 'main',
  visibility: 'private',
  canPush: true,
  archived: false,
  verified: true
} as const

/**
 * Grava em `userDataDir` a config v2 (da 2C) com os bancos do Notion já escolhidos e um projeto
 * vinculado à página "Orkio Desktop": o ponto de partida dos specs a partir do quadro.
 */
export function seedConfig(
  userDataDir: string,
  project: { id: string; name: string; localPath: string; repo: typeof FAKE_REPO | null }
): void {
  writeFileSync(
    join(userDataDir, 'orkio-config.json'),
    JSON.stringify({
      schemaVersion: 2,
      notion: {
        projectsDataSource: { id: NOTION_FAKE.projectsDs, name: 'Projetos' },
        tasksDataSource: { id: NOTION_FAKE.tasksDs, name: 'Tarefas' },
        mapping: NOTION_MAPPING,
        updatedAt: '2026-11-19T00:00:00.000Z'
      },
      projects: [
        {
          ...project,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          notionProject: { id: NOTION_FAKE.orkioPage, name: 'Orkio Desktop' }
        }
      ]
    })
  )
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
    /** `setup`: fica nos Primeiros passos (sem projeto, o app abre neles). */
    startPage?: 'projects' | 'integrations' | 'setup'
    /** Claude Code simulado: `installed: false` tira o CLI do PATH. */
    claude?: { loggedIn?: boolean; installed?: boolean }
    /**
     * 5B: alva-flow simulado. `plugin` instala o plugin no HOME de teste; `mcpBacklog` faz o
     * `claude mcp list` mostrar o MCP do Backlog; `gh` simula o GitHub CLI; `blockers` = quantos
     * /review deixam blocker antes de passar.
     */
    alva?: {
      plugin?: boolean
      mcpBacklog?: boolean
      gh?: 'ok' | 'logged_out' | 'missing'
      blockers?: number
    }
  } = {}
): Promise<OrkioApp> {
  const env = { ...process.env } as Record<string, string>
  delete env['WAYLAND_DISPLAY']
  env['ELECTRON_OZONE_PLATFORM_HINT'] = 'x11'
  // Opções do Node que o Electron rejeita (ex.: --use-openssl-ca) poluem o log.
  delete env['NODE_OPTIONS']
  // Claude Code SIMULADO sempre primeiro no PATH: o E2E nunca chama o CLI real (4A).
  const fakeBin = fakeClaudeBin(userDataDir, options.claude ?? { loggedIn: true }, options.alva)
  env['PATH'] = `${fakeBin}${delimiter}${env['PATH'] ?? ''}`
  // HOME isolado: o catálogo de comandos nunca lê o ~/.claude de verdade no E2E.
  const home = `${userDataDir}-home`
  mkdirSync(join(home, '.claude', 'commands'), { recursive: true })
  writeFileSync(
    join(home, '.claude', 'commands', 'revisar.md'),
    '---\nname: revisar\ndescription: Revisa o diff da tarefa\n---\nCORPO'
  )
  if (options.alva?.plugin) installFakeAlvaPlugin(home)
  env['HOME'] = home
  env['USERPROFILE'] = home
  // Simulado do alva-flow: quantos /review deixam blocker (não começa com ORKIO_: passa o filtro).
  env['FAKE_ALVA_BLOCKERS'] = String(options.alva?.blockers ?? 1)
  // Chave "vazada" no ambiente: o Orkio precisa filtrá-la antes de abrir o CLI.
  env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-E2E-NAO-PODE-VAZAR'

  const args = ['.', `--user-data-dir=${userDataDir}`]
  // Sempre X11 (o display virtual do xvfb-run): no Wayland o Electron abriria a janela na tela de
  // quem roda o teste, mesmo sem WAYLAND_DISPLAY (usa o socket padrão wayland-0).
  if (process.platform === 'linux') args.push('--ozone-platform=x11')
  // Chromium não roda como root sem --no-sandbox (containers de CI).
  if (process.getuid?.() === 0) args.push('--no-sandbox')

  const app = await electron.launch({ args, cwd: ROOT, env })
  const logs: string[] = []
  app.process().stdout?.on('data', (d: Buffer) => logs.push(String(d)))
  app.process().stderr?.on('data', (d: Buffer) => logs.push(String(d)))

  await app.evaluate(
    ({ safeStorage, shell, dialog }, { initial, siteUrl, ids, contract }) => {
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
        addedProperties: {},
        published: []
      }
      const realFetch = globalThis.fetch
      const json = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), { status })

      shell.openExternal = async (url: string) => {
        g.__opened.push(url)
        const parsed = new URL(url)
        if (parsed.origin + parsed.pathname !== 'https://api.notion.com/v1/oauth/authorize') return
        const redirect = new URL(parsed.searchParams.get('redirect_uri') ?? '')
        redirect.searchParams.set('state', parsed.searchParams.get('state') ?? '')
        if (g.__fakes.browser === 'ignore') return
        if (g.__fakes.browser === 'deny') redirect.searchParams.set('error', 'access_denied')
        else redirect.searchParams.set('code', 'e2e-auth-code')
        // Redirect de verdade para o servidor local do app (já escutando: ele só abre o navegador
        // depois do listen). Como um navegador, não espera a resposta; uma falha vai para o log.
        void realFetch(redirect.toString()).catch((e: unknown) =>
          console.error('[e2e] redirect do OAuth falhou:', e)
        )
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

        if (url.startsWith(siteUrl) && g.__fakes.siteTarget) {
          const target = `${g.__fakes.siteTarget}${url.slice(siteUrl.length)}`
          const response = await realFetch(target, init)
          call.status = response.status
          return response
        }
        // Site do Orkio simulado: o orkio[bot] está instalado no repositório? (Integrações ›
        // Orkio bot). Formato de `site/lib/github-app.ts` (o E2E @site usa o site de verdade).
        if (url === `${siteUrl}/github/installation` && init?.method === 'POST') {
          const body = JSON.parse(call.body ?? '{}') as { owner: string; repo: string }
          const installed = (g.__fakes.orkioBotInstalled ?? []).includes(
            `${body.owner}/${body.repo}`
          )
          return json({ installed, installUrl: contract.installUrl })
        }
        // Task 18: o site posta a revisão como orkio[bot]. Como o GitHub: a revisão entra nos
        // detalhes da PR e `updated_at` muda.
        if (url === `${siteUrl}/github/review` && init?.method === 'POST') {
          const body = JSON.parse(call.body ?? '{}') as {
            owner: string
            repo: string
            number: number
            userToken?: string
            review: NonNullable<FakeGlobals['__notion']['siteReviews']>[number]['review']
          }
          const list = (g.__notion.siteReviews ??= [])
          list.push({
            owner: body.owner,
            repo: body.repo,
            number: body.number,
            hasUserToken: typeof body.userToken === 'string' && body.userToken.length > 0,
            review: body.review
          })
          const id = 900 + list.length
          const now = new Date().toISOString()
          const d = g.__fakes.githubPrDetails[String(body.number)]
          if (d) {
            d.reviews = [
              ...(d.reviews ?? []),
              ...(body.review.event === 'REQUEST_CHANGES'
                ? [
                    {
                      id: `REV-ORKIO-${id}`,
                      state: 'CHANGES_REQUESTED' as const,
                      submittedAt: now,
                      author: { login: 'orkio[bot]' }
                    }
                  ]
                : [])
            ]
            if (body.review.event === 'REQUEST_CHANGES') d.reviewDecision = 'CHANGES_REQUESTED'
          }
          g.__fakes.githubPulls = g.__fakes.githubPulls.map((p) =>
            p.number === body.number ? { ...p, updatedAt: now } : p
          )
          return json({
            url: `https://github.com/${body.owner}/${body.repo}/pull/${body.number}#pullrequestreview-${id}`
          })
        }
        if (url.startsWith(`${siteUrl}/notion/`)) {
          if (g.__fakes.notionOAuth === 'down') throw new TypeError('fetch failed')
          if (g.__fakes.notionOAuth === 'invalid_grant')
            return json({ error: 'invalid_grant' }, 400)
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

        // Fase 0: medidor de uso do Claude (só com o token das credenciais simuladas do Claude Code).
        if (url.startsWith('https://api.anthropic.com/api/oauth/usage')) {
          if (!g.__fakes.claudeUsage || call.auth !== `Bearer ${contract.claudeToken}`) {
            return json({ error: 'not_found' }, 404)
          }
          return json(g.__fakes.claudeUsage)
        }
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
                head: { ref: p.head, ...(p.sha ? { sha: p.sha } : {}) },
                ...(p.author ? { user: { login: p.author } } : {}),
                ...(p.createdAt ? { created_at: p.createdAt } : {})
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
        const reviewersMatch =
          /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/requested_reviewers$/.exec(
            url
          )
        if (reviewersMatch && init?.method === 'POST') {
          const n = Number(reviewersMatch[3])
          const body = JSON.parse(call.body ?? '{}') as {
            reviewers?: string[]
            team_reviewers?: string[]
          }
          ;(g.__notion.reviewRequests ??= []).push({
            pull: n,
            reviewers: body.reviewers ?? [],
            teams: body.team_reviewers ?? []
          })
          // Como o GitHub: novo evento na linha do tempo e `updated_at` da PR muda.
          const now = new Date().toISOString()
          const d = g.__fakes.githubPrDetails[String(n)]
          if (d) {
            d.reviewRequests = [
              ...(d.reviewRequests ?? []),
              ...(body.reviewers ?? []).map((login, i) => ({
                id: `RR-${n}-${(d.reviewRequests ?? []).length + i + 1}`,
                createdAt: now,
                requestedReviewer: { login }
              }))
            ]
            d.reviewDecision = 'REVIEW_REQUIRED'
          }
          g.__fakes.githubPulls = g.__fakes.githubPulls.map((p) =>
            p.number === n ? { ...p, updatedAt: now } : p
          )
          return json({ number: n }, 201)
        }
        const filesMatch =
          /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/files\?/.exec(url)
        if (filesMatch) {
          call.status = 200
          return json(g.__fakes.githubPrFiles?.[filesMatch[1]!] ?? [])
        }
        if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/collaborators\?/.test(url)) {
          return json([{ login: 'ana' }, { login: 'bia' }])
        }
        if (url === 'https://api.github.com/graphql') {
          const query = String((JSON.parse(call.body ?? '{}') as { query?: string }).query)
          // Cada query do Orkio tem nome (`query ReviewThreads(...)`): o simulado responde por ele.
          const operation = /^\s*query\s+(\w+)/.exec(query)?.[1]
          // Reproduz o OAuth sem read:org: o GitHub valida o escopo antes de executar.
          if (query.includes('on Team') || g.__fakes.githubGraphql === 'no_scope') {
            return json({
              data: null,
              errors: [
                {
                  type: 'INSUFFICIENT_SCOPES',
                  message: 'Your token has not been granted the required scopes (read:org).'
                }
              ]
            })
          }
          // Task 15: texto das threads de uma PR.
          if (operation === 'ReviewThreads') {
            const vars = (JSON.parse(call.body ?? '{}') as { variables?: { number?: number } })
              .variables
            const d = g.__fakes.githubPrDetails[String(vars?.number)]
            return json({
              data: {
                repository: {
                  pullRequest: d
                    ? {
                        reviewThreads: {
                          nodes: (d.threads ?? []).map((t) => ({
                            ...t,
                            isOutdated: t.isOutdated ?? false,
                            comments: {
                              nodes: t.comments.map((c) => ({ ...c, author: { login: c.author } }))
                            }
                          }))
                        },
                        reviews: { nodes: [] }
                      }
                    : null
                }
              }
            })
          }
          if (operation !== 'PullRequestDetails') {
            return json({
              data: null,
              errors: [{ message: `operação desconhecida: ${operation}` }]
            })
          }
          // Sinais: detalhes de várias PRs numa query só, uma por alias (`pr12: pullRequest(...)`).
          const repository: Record<string, unknown> = {}
          for (const match of query.matchAll(/pr(\d+): pullRequest/g)) {
            const d = g.__fakes.githubPrDetails[match[1]!]
            repository[`pr${match[1]}`] = d
              ? {
                  number: Number(match[1]),
                  additions: d.additions,
                  deletions: d.deletions,
                  changedFiles: d.changedFiles,
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
                owner: {
                  type: 'user',
                  user: { id: 'user-grace', name: 'Grace Hopper', avatar_url: null }
                },
                workspace_name: 'Acme Labs'
              }
            })
          }
          return json({ object: 'user', id: 'u1', type: 'person', name: 'Ada Lovelace' })
        }

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

          if (path === '/pages' && init?.method === 'POST') {
            if (g.__fakes.notionWrites === 'reject') {
              return json({ object: 'error', code: 'restricted_resource' }, 403)
            }
            const parent = (body['parent'] as { page_id?: string } | undefined)?.page_id ?? ''
            const props = body['properties'] as
              { title?: { title?: { text?: { content?: string } }[] } } | undefined
            const n = g.__notion.published.length + 1
            g.__notion.published.push({
              kind: 'child_page',
              parent,
              title: props?.title?.title?.[0]?.text?.content ?? '',
              markdown: String(body['markdown'] ?? '')
            })
            const id = `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`
            return json({ object: 'page', id, url: `https://www.notion.so/artefato-${n}` })
          }
          const mdPatch = /^\/pages\/([0-9a-f-]+)\/markdown$/.exec(path)
          if (mdPatch && init?.method === 'PATCH') {
            if (g.__fakes.notionWrites === 'reject') {
              return json({ object: 'error', code: 'restricted_resource' }, 403)
            }
            const insert = body['insert_content'] as { content?: string } | undefined
            g.__notion.published.push({
              kind: 'section',
              parent: mdPatch[1]!,
              markdown: String(insert?.content ?? '')
            })
            return json({ object: 'page_markdown', id: mdPatch[1] })
          }

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
          const children = /^\/blocks\/([0-9a-f-]+)\/children/.exec(path)
          if (children) {
            const para = (text: string): unknown => ({
              type: 'paragraph',
              paragraph: { rich_text: rich(text) }
            })
            const blocks =
              children[1] === 'cccccccc-0000-4000-8000-000000000001'
                ? [para('Detalhe aninhado')]
                : children[1] === 'eeeeeeee-0000-4000-8000-000000000001'
                  ? [para('Camadas: main, preload, renderer.')]
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
            // O Orkio filtra por projeto E responsável (a pessoa logada): `{ and: [...] }`.
            // A busca (searchTasks) usa `{ or: [título, ID] }` ou só o título, no banco inteiro.
            type Clause = {
              property?: string
              relation?: { contains?: string }
              people?: { contains?: string }
              title?: { contains?: string }
              unique_id?: { equals?: number }
            }
            const raw = body['filter'] as (Clause & { and?: Clause[]; or?: Clause[] }) | undefined
            const search = raw?.or ?? (raw?.title ? [raw] : null)
            const clauses = search ? [] : (raw?.and ?? (raw ? [raw] : []))
            const target = clauses.find((c) => c.property === 'rel')?.relation?.contains
            const person = clauses.find((c) => c.property === 'ppl')?.people?.contains
            const task = (
              n: number,
              title: string,
              project: string,
              _initial: { name: string; color: string },
              priority: boolean,
              owners: string[] = ['u1', 'user-grace']
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
                  Responsável: {
                    id: 'ppl',
                    type: 'people',
                    // Sem nome: o card não ganha texto novo nos testes antigos.
                    people: owners.map((o) => ({ object: 'user', id: o }))
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
              task(3, 'Nova home do site', ids.sitePage, { name: 'A fazer', color: 'gray' }, false),
              // De outra pessoa: nunca aparece para quem está logado.
              task(
                9,
                'Tarefa de outra pessoa',
                ids.orkioPage,
                { name: 'Em andamento', color: 'blue' },
                false,
                ['someone-else']
              )
            ]
            return json({
              object: 'list',
              results: all.filter((t) => {
                const props = (
                  t as {
                    properties: {
                      Projeto: { relation: { id: string }[] }
                      Responsável: { people: { id: string }[] }
                    }
                  }
                ).properties
                if (target && props.Projeto.relation[0]?.id !== target) return false
                if (person && !props.Responsável.people.some((p) => p.id === person)) return false
                if (search) {
                  const page = t as {
                    properties: {
                      Nome: { title: { plain_text: string }[] }
                      ID: { unique_id: { number: number } }
                    }
                  }
                  const title = page.properties.Nome.title.map((r) => r.plain_text).join('')
                  return search.some((c) =>
                    c.title?.contains !== undefined
                      ? title.toLowerCase().includes(c.title.contains.toLowerCase())
                      : c.unique_id?.equals === page.properties.ID.unique_id.number
                  )
                }
                return true
              }),
              has_more: false,
              next_cursor: null
            })
          }
        }

        return json({ object: 'error', code: 'not_found' }, 404)
      }
    },
    {
      initial: { ...DEFAULT_FAKES, ...fakes },
      siteUrl: E2E_SITE_URL,
      ids: NOTION_FAKE,
      contract: { installUrl: E2E_INSTALL_URL, claudeToken: CLAUDE_USAGE_TOKEN }
    }
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
  // Sem projeto: Primeiros passos → "Fazer depois" → Projetos. Com projeto: menu → Projetos.
  // Os specs de integrações começam em Integrações; o de setup fica nos Primeiros passos.
  if (options.startPage === 'setup') return { app, page, logs }
  await enterApp(page)
  if ((options.startPage ?? 'integrations') === 'integrations') {
    await openSettings(page, 'Integrações')
    await expandIntegrations(page)
  }
  return { app, page, logs }
}

/**
 * Entra no app depois de abrir/recarregar e vai para Configurações › Projetos: sem projetos, sai
 * dos Primeiros passos por "Fazer depois"; com projetos, vai pelo menu.
 */
export async function enterApp(page: Page): Promise<void> {
  const setup = page.getByRole('list', { name: 'Primeiros passos' })
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(setup.or(nav)).toBeVisible()
  if (await setup.isVisible()) {
    await page.getByRole('button', { name: 'Fazer depois' }).click()
  }
  await openSettings(page, 'Projetos')
}

/**
 * Integrações: espera os estados carregarem. A grade abre um painel por vez (o primeiro que ainda
 * não está pronto, sozinho); `openIntegration` abre o card de que o teste precisa.
 */
export async function expandIntegrations(page: Page): Promise<void> {
  for (const name of ['Notion', 'GitHub', 'Claude Code']) {
    const card = page.getByRole('article', { name, exact: true })
    await expect(card.getByTestId('integration-status')).not.toContainText('Verificando')
  }
}

/** Abre o painel de configuração de um card de Integrações (se já não estiver aberto). */
export async function openIntegration(
  page: Page,
  name: 'Notion' | 'Bancos e campos' | 'GitHub' | 'Claude Code' | 'Orkio bot'
): Promise<void> {
  await expandIntegrations(page)
  const card = page.getByRole('article', { name, exact: true })
  const close = card.getByRole('button', { name: `Fechar ${name}` })
  if ((await close.count()) > 0) return
  await card.getByRole('button', { name: new RegExp(`^(?!Fechar).* ${name}$`) }).click()
  await expect(close).toBeVisible()
}

/** Configurações › seção (Integrações, Projetos, Quadro e automações, ...). */
export async function openSettings(page: Page, section: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: 'Configurações', exact: true })
    .click()
  const item = page
    .getByRole('navigation', { name: 'Configurações' })
    .getByRole('button', { name: section, exact: true })
  if ((await item.count()) > 0) await item.click()
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

/**
 * 6C: atualização SIMULADA. Pega o mesmo `autoUpdater` (singleton do electron-updater, que fica
 * fora do bundle) e troca a checagem e a instalação por versões falsas; liga `forceDevUpdateConfig`
 * (flag oficial do electron-updater) porque o app do E2E não é empacotado. A checagem "acha" a
 * versão e "baixa" na hora; instalar só conta (o app não fecha).
 */
export async function simulateUpdate(
  app: ElectronApplication,
  update: { version: string } | null,
  /** Resposta ao diálogo "Reiniciar agora?" (padrão "Depois"). */
  restart = false
): Promise<void> {
  await app.evaluate(
    ({ dialog }, [next, answer]) => {
      type FakeUpdater = {
        forceDevUpdateConfig: boolean
        autoDownload: boolean
        checkForUpdates(): Promise<unknown>
        quitAndInstall(): void
        emit(event: string, arg?: unknown): boolean
      }
      const g = globalThis as unknown as { __updateInstalls?: number; __restartPrompts?: string[] }
      g.__restartPrompts ??= []
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const opts = args.at(-1) as { message?: string }
        g.__restartPrompts!.push(opts.message ?? '')
        return { response: answer ? 0 : 1, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      // O módulo já carregado pelo main (cache do require do Node): o mesmo singleton do app.
      const Module = (process as unknown as { mainModule: { constructor: unknown } }).mainModule
        .constructor as { _cache: Record<string, { exports: unknown }> }
      const key = Object.keys(Module._cache).find((k) =>
        /[\\/]electron-updater[\\/]out[\\/]main\.js$/.test(k)
      )
      if (!key) throw new Error('electron-updater não carregado')
      const u = (Module._cache[key]!.exports as { autoUpdater: FakeUpdater }).autoUpdater
      g.__updateInstalls ??= 0
      u.forceDevUpdateConfig = true
      u.checkForUpdates = async () => {
        u.emit('checking-for-update')
        if (!next) {
          u.emit('update-not-available', { version: '0.0.0' })
          return null
        }
        const info = {
          version: next.version,
          files: [{ url: `Orkio-${next.version}-win-x64-setup.exe` }]
        }
        u.emit('update-available', info)
        if (u.autoDownload) {
          u.emit('download-progress', { percent: 50 })
          u.emit('update-downloaded', info)
        }
        return { updateInfo: info }
      }
      u.quitAndInstall = () => {
        g.__updateInstalls = (g.__updateInstalls ?? 0) + 1
      }
    },
    [update, restart] as const
  )
}

/** Mensagens do diálogo "Reiniciar agora?" mostradas até aqui. */
export async function restartPrompts(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __restartPrompts?: string[] }).__restartPrompts ?? []
  )
}

export async function updateInstalls(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    () => (globalThis as unknown as { __updateInstalls?: number }).__updateInstalls ?? 0
  )
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

export function alerts(scope: Page | Locator): Locator {
  return scope.locator('[role="alert"]')
}

/** Enfileira caminhos para as próximas aberturas de "Salvar como…" (no main). */
export async function queueSavePaths(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate((_electron, next) => {
    ;(globalThis as unknown as FakeGlobals).__savePaths.push(...next)
  }, paths)
}

/**
 * Versão do `claude` simulado (`--version`; aceita `--effort`) e os trechos dos pedidos do Orkio
 * que escolhem o cenário dele. Vão para `fake-claude.json` ao lado da cópia do script.
 */
/** Fase 0: token OAuth simulado do Claude Code (credenciais no HOME de teste). */
export const CLAUDE_USAGE_TOKEN = 'sk-ant-oat01-E2E-NAO-PODE-IR-PARA-A-TELA'

/** Grava as credenciais simuladas do Claude Code no HOME de teste (antes de abrir o app). */
export function writeClaudeCredentials(userDataDir: string): void {
  const dir = join(`${userDataDir}-home`, '.claude')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken: CLAUDE_USAGE_TOKEN, expiresAt: Date.now() + 3_600_000 }
    })
  )
}

export const FAKE_CLAUDE = {
  version: '2.1.331',
  markers: {
    /** Cabeçalho do briefing no prompt (`run.service`). */
    briefing: 'Briefing da tarefa',
    /** Seção do briefing (`shared/briefing`). */
    criteria: 'Critérios de aceite',
    /** Passo de plano da revisão da PR (cita o arquivo da revisão). */
    reviewFile: 'revisao.md',
    reviewApply: REVIEW_APPLY_PROMPT.split('.')[0]!,
    reviewJson: REVIEW_JSON_PROMPT.split(' no JSON')[0]!
  }
} as const

/** Pasta com o `claude` simulado (e2e/fake-claude) e o estado de login dele. */
function fakeClaudeBin(
  userDataDir: string,
  claude: { loggedIn?: boolean; installed?: boolean },
  alva?: { mcpBacklog?: boolean; gh?: 'ok' | 'logged_out' | 'missing' }
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
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ backlog: alva?.mcpBacklog === true }))
    writeFileSync(join(dir, 'fake-claude.json'), JSON.stringify(FAKE_CLAUDE))
  }
  writeFileSync(
    join(dir, 'x-terminal-emulator'),
    ['#!/bin/sh', 'echo "$PWD $*" >> "$(dirname "$0")/terminal-calls.log"', 'exit 0', ''].join('\n')
  )
  chmodSync(join(dir, 'x-terminal-emulator'), 0o755)
  const gh = alva?.gh ?? 'missing'
  if (gh !== 'missing') {
    writeFileSync(
      join(dir, 'gh'),
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo "gh version 2.60.0"; exit 0; fi',
        `if [ "$1 $2" = "auth status" ]; then exit ${gh === 'ok' ? 0 : 1}; fi`,
        'if [ "$1 $2" = "alias list" ]; then exit 0; fi',
        'echo "$*" >> "$(dirname "$0")/gh-calls.log"',
        'if [ "$1 $2" = "pr create" ]; then echo "https://github.com/acme/orkio-app/pull/7"; exit 0; fi',
        'if [ "$1" = "pr" ] || [ "$1" = "api" ] || [ "$1" = "run" ]; then echo "{}"; exit 0; fi',
        'exit 1',
        ''
      ].join('\n')
    )
    chmodSync(join(dir, 'gh'), 0o755)
  }
  return dir
}

/** Plugin alva-flow simulado no HOME de teste (installed_plugins.json + comandos + versão). */
function installFakeAlvaPlugin(home: string): void {
  const plugin = join(home, '.claude', 'plugins', 'cache', 'alva-flow')
  mkdirSync(join(plugin, 'commands'), { recursive: true })
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(plugin, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'alva-flow', version: '1.0.25' })
  )
  for (const c of ['spec', 'plan', 'implement', 'review', 'fix', 'commit', 'pr']) {
    writeFileSync(
      join(plugin, 'commands', `${c}.md`),
      `---\ndescription: ${c} do fluxo Alva\n---\nCORPO`
    )
  }
  writeFileSync(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'alva-flow@alva-flow-marketplace': [{ installPath: plugin }] } })
  )
}

/** Pastas em que o "Abrir terminal aqui" foi chamado (uma linha por chamada). */
export function terminalCalls(userDataDir: string): string[] {
  const file = join(`${userDataDir}-bin`, 'terminal-calls.log')
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
}

/** 5C: chamadas ao GitHub CLI simulado (uma linha por chamada, os argumentos). */
export function ghCalls(userDataDir: string): string[] {
  const file = join(`${userDataDir}-bin`, 'gh-calls.log')
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []
}

/** Telas do menu (Quadro, Agentes, Configurações) e seções de Configurações pelo nome antigo. */
export async function navTo(page: Page, name: string): Promise<void> {
  if (name === 'Quadro' || name === 'Agentes' || name === 'Configurações') {
    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('group', { name: 'Telas' })
      .getByRole('button', { name, exact: true })
      .click()
    return
  }
  if (name === 'Fluxos') {
    await openSettings(page, 'Quadro e automações')
    await page.getByRole('tab', { name: 'Fluxos', exact: true }).click()
    return
  }
  const section = name === 'Etapas e automações' ? 'Quadro e automações' : name
  await openSettings(page, section)
}

/** Aba de Quadro e automações (Colunas, Automações N, Fluxos, Entrega). */
export async function boardSettingsTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click()
}

/** Tela da tarefa (fases, conversa e o painel da fase). */
export function taskScreen(page: Page, id: string): Locator {
  return page.getByRole('region', { name: `Tarefa ${id}`, exact: true })
}

/**
 * Histórico completo da tarefa (todos os eventos): fica recolhido na aba Detalhes do painel da
 * fase. Abre e confere os textos.
 */
export async function expectTaskHistory(scope: Locator, ...texts: string[]): Promise<Locator> {
  // A tela da tarefa sempre tem a aba (espera ela aparecer: a tela pode estar abrindo).
  await scope.getByRole('tab', { name: 'Detalhes', exact: true }).click()
  // Outras abas (PR & CI) também montam o miolo dos detalhes, escondido: procura só na visível.
  const area = scope.getByRole('tabpanel', { name: 'Detalhes', exact: true })
  const list = area.getByRole('list', { name: 'Histórico da tarefa' })
  if (!(await list.isVisible())) await area.getByText('Histórico completo').click()
  for (const t of texts) await expect(list).toContainText(t)
  return list
}

/**
 * Aba do painel da fase na tela da tarefa (Spec, Plano, Mudanças, PR & CI, Detalhes). "Sessão" é
 * a conversa, sempre visível: devolve a própria tela.
 */
export async function taskTab(
  screen: Locator,
  name: 'Sessão' | 'Spec' | 'Plano' | 'Mudanças' | 'PR & CI' | 'Revisão' | 'Detalhes'
): Promise<Locator> {
  if (name === 'Sessão') return screen
  await screen.getByRole('tab', { name, exact: true }).click()
  return screen.getByRole('tabpanel', { name, exact: true })
}
