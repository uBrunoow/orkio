/**
 * Configurações (Fase 4): grupos do menu lateral, palavras de busca e a quem cada seção vale.
 * Puro (sem React): a coluna (`SettingsNav`) e a barra da tela leem daqui.
 */
import { normalizeLabel } from '../../../../shared/text'
import { SETTINGS_TITLES, type SettingsSection } from '../../app/routes'

export interface SettingsGroup {
  id: 'basic' | 'connections' | 'tools' | 'project' | 'app'
  title: string
  /** Só com um projeto vinculado (o título ganha o nome dele). */
  project?: true
  items: readonly SettingsSection[]
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'basic',
    title: 'Básico',
    items: ['general', 'appearance', 'layout', 'notifications', 'shortcuts', 'terminal']
  },
  { id: 'connections', title: 'Conexões', items: ['integrations', 'projects', 'providers'] },
  { id: 'tools', title: 'Agentes e ferramentas', items: ['skills', 'mcp', 'secrets'] },
  { id: 'project', title: 'Por projeto', project: true, items: ['board', 'agents', 'servers'] },
  { id: 'app', title: 'App', items: ['diagnostics', 'updates', 'about'] }
]

/** Palavras a mais da busca (o título já conta). Sem acento/caixa na comparação. */
export const SETTINGS_KEYWORDS: Record<SettingsSection, readonly string[]> = {
  general: [
    'modelo',
    'raciocínio',
    'padrão',
    'sessão',
    'autonomia',
    'permissão',
    'decisões lembradas',
    'revogar',
    'privacidade'
  ],
  appearance: [
    'tema',
    'escuro',
    'claro',
    'movimento',
    'animação',
    'texto',
    'fonte',
    'tamanho',
    'zoom',
    'letras',
    'espaçamento',
    'fundo',
    'wallpaper'
  ],
  layout: ['desktop', 'painéis', 'divisão', 'arranjo', 'foco', 'largura', 'centralizar', 'janela'],
  notifications: ['aviso', 'som', 'silenciar', 'sino', 'alerta'],
  shortcuts: ['teclado', 'tecla', 'atalho global', 'trazer para a frente'],
  terminal: ['shell', 'console', 'pty'],
  integrations: ['notion', 'github', 'claude code', 'conta', 'token', 'login', 'bot'],
  projects: ['pasta', 'repositório', 'branch'],
  providers: ['claude', 'anthropic', 'uso', 'medidor', 'assinatura', 'login'],
  board: ['colunas', 'etapas', 'automações', 'fluxos', 'entrega', 'alva'],
  agents: ['orquestrador', 'atribuição', 'regras'],
  servers: ['frontend', 'backend', 'porta', 'dev', 'localhost', 'subir'],
  skills: ['habilidades', 'comandos', 'plugins'],
  mcp: ['servidores', 'ferramentas', 'model context protocol'],
  secrets: ['senhas', 'chaves', 'api key', 'variáveis', 'cofre', 'tokens'],
  diagnostics: ['diagnóstico', 'armazenamento', 'disco', 'espaço', 'conferir', 'ajuda', 'suporte'],
  updates: ['versão', 'canal', 'beta', 'energia', 'acordado', 'suspensão'],
  about: ['versão', 'site', 'privacidade', 'termos']
}

/** Grupo que sai na coluna, com o título final (o do projeto leva o nome). */
export interface VisibleGroup {
  id: SettingsGroup['id']
  title: string
  items: SettingsSection[]
}

/** Grupos e itens visíveis: sem projeto vinculado, some o grupo do projeto; a busca filtra. */
export function visibleSettingsGroups(projectName: string | null, query: string): VisibleGroup[] {
  const q = normalizeLabel(query)
  return SETTINGS_GROUPS.filter((g) => !g.project || projectName)
    .map((g) => ({
      id: g.id,
      title: g.title,
      items: g.items.filter((s) => matchesSettingsQuery(s, q, g.title))
    }))
    .filter((g) => g.items.length > 0)
}

function matchesSettingsQuery(section: SettingsSection, q: string, group: string): boolean {
  if (!q) return true
  return [SETTINGS_TITLES[section], group, ...SETTINGS_KEYWORDS[section]].some((w) =>
    normalizeLabel(w).includes(q)
  )
}

/**
 * A quem a mudança da seção vale (linha "Vale para: …" no topo). `null` = a própria tela diz
 * (Skills, Servidores MCP e Segredos trazem o próprio cabeçalho com o escopo).
 */
export function settingsScope(section: SettingsSection, projectName: string | null): string | null {
  switch (section) {
    case 'general':
      return 'todas as execuções sem agente, em todos os projetos'
    case 'appearance':
    case 'layout':
    case 'notifications':
    case 'shortcuts':
    case 'diagnostics':
    case 'updates':
    case 'about':
      return 'este computador'
    case 'terminal':
      return 'os terminais de todas as tarefas, neste computador'
    case 'integrations':
      return 'todos os projetos'
    case 'projects':
      return 'este computador'
    case 'providers':
      return 'o seu Claude Code neste computador'
    case 'board':
      return projectName ? `o projeto ${projectName}` : 'o projeto atual'
    case 'agents':
      return projectName ? `o projeto ${projectName}` : 'todos os projetos'
    case 'servers':
      return projectName ? `as tarefas do projeto ${projectName}` : 'o projeto atual'
    case 'skills':
    case 'mcp':
    case 'secrets':
      return null
  }
}
