/**
 * Briefing da tarefa para o Claude Code (Etapa 4A): blocos da página do Notion → markdown e a
 * montagem do briefing. Funções puras. O conteúdo fica só em memória e no log da execução.
 */

export interface NotionBlock {
  id?: string
  type: string
  has_children?: boolean
  /** Filhos já buscados (paginação feita por quem chama). */
  children?: NotionBlock[]
  [key: string]: unknown
}

interface RichText {
  plain_text?: string
  href?: string | null
  annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; code?: boolean }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const FENCE = '`'.repeat(3)

/** Rich text do Notion → markdown inline. */
export function richTextToMarkdown(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      if (!isRecord(part)) return ''
      const rt = part as RichText
      let text = rt.plain_text ?? ''
      if (!text) return ''
      const a = rt.annotations ?? {}
      if (a.code) text = '`' + text + '`'
      if (a.bold) text = `**${text}**`
      if (a.italic) text = `*${text}*`
      if (a.strikethrough) text = `~~${text}~~`
      if (rt.href) text = `[${text}](${rt.href})`
      return text
    })
    .join('')
}

/** Texto puro (sem marcações), para código. */
function plain(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((p) => (isRecord(p) && typeof p['plain_text'] === 'string' ? p['plain_text'] : ''))
    .join('')
}

function payload(block: NotionBlock): Record<string, unknown> {
  const p = block[block.type]
  return isRecord(p) ? p : {}
}

function fileUrl(p: Record<string, unknown>): string | null {
  for (const key of ['file', 'external']) {
    const f = p[key]
    if (isRecord(f) && typeof f['url'] === 'string') return f['url']
  }
  return null
}

const MEDIA_LABEL: Record<string, string> = {
  image: 'imagem',
  video: 'vídeo',
  file: 'arquivo',
  pdf: 'PDF'
}

/**
 * Blocos → markdown. Tipos não suportados viram uma linha de aviso (e entram em `unsupported`),
 * para o Claude saber que falta algo e o usuário ver o que não foi convertido.
 */
export function blocksToMarkdown(
  blocks: readonly NotionBlock[],
  depth = 0
): { markdown: string; unsupported: string[] } {
  const lines: string[] = []
  const unsupported: string[] = []
  const indent = '  '.repeat(depth)
  let number = 0

  for (const block of blocks) {
    const p = payload(block)
    const text = richTextToMarkdown(p['rich_text'])
    if (block.type !== 'numbered_list_item') number = 0
    const children = (): string => {
      if (!block.children || block.children.length === 0) return ''
      const inner = blocksToMarkdown(block.children, depth + 1)
      unsupported.push(...inner.unsupported)
      return inner.markdown ? `\n${inner.markdown}` : ''
    }

    switch (block.type) {
      case 'paragraph':
        lines.push(`${indent}${text}${children()}`)
        break
      case 'heading_1':
        lines.push(`# ${text}`)
        break
      case 'heading_2':
        lines.push(`## ${text}`)
        break
      case 'heading_3':
        lines.push(`### ${text}`)
        break
      case 'bulleted_list_item':
        lines.push(`${indent}- ${text}${children()}`)
        break
      case 'numbered_list_item':
        number++
        lines.push(`${indent}${number}. ${text}${children()}`)
        break
      case 'to_do':
        lines.push(`${indent}- [${p['checked'] === true ? 'x' : ' '}] ${text}${children()}`)
        break
      case 'toggle':
        lines.push(`${indent}- ${text}${children()}`)
        break
      case 'quote':
        lines.push(`${indent}> ${text}${children()}`)
        break
      case 'callout': {
        const icon =
          isRecord(p['icon']) && typeof p['icon']['emoji'] === 'string'
            ? `${p['icon']['emoji']} `
            : ''
        lines.push(`${indent}> ${icon}${text}${children()}`)
        break
      }
      case 'code': {
        const lang =
          typeof p['language'] === 'string' && p['language'] !== 'plain text' ? p['language'] : ''
        lines.push(`${indent}${FENCE}${lang}\n${plain(p['rich_text'])}\n${indent}${FENCE}`)
        break
      }
      case 'divider':
        lines.push('---')
        break
      case 'equation':
        lines.push(`$$${typeof p['expression'] === 'string' ? p['expression'] : ''}$$`)
        break
      case 'bookmark':
      case 'embed':
      case 'link_preview': {
        const url = typeof p['url'] === 'string' ? p['url'] : ''
        lines.push(`${indent}<${url}>`)
        break
      }
      case 'image':
      case 'video':
      case 'file':
      case 'pdf': {
        const caption = richTextToMarkdown(p['caption'])
        const url = fileUrl(p)
        lines.push(
          `${indent}[${MEDIA_LABEL[block.type]}${caption ? `: ${caption}` : ''}]${url ? `(${url})` : ''}`
        )
        break
      }
      case 'child_page':
        lines.push(`${indent}[subpágina: ${typeof p['title'] === 'string' ? p['title'] : ''}]`)
        break
      case 'child_database':
        lines.push(`${indent}[banco: ${typeof p['title'] === 'string' ? p['title'] : ''}]`)
        break
      case 'table': {
        const rows = (block.children ?? []).filter((r) => r.type === 'table_row')
        const cells = rows.map((r) => {
          const c = payload(r)['cells']
          return Array.isArray(c)
            ? c.map((cell) => richTextToMarkdown(cell).replace(/\|/g, '\\|'))
            : []
        })
        if (cells.length > 0) {
          const width = Math.max(...cells.map((c) => c.length))
          const row = (c: string[]): string =>
            `| ${[...c, ...Array<string>(width - c.length).fill('')].join(' | ')} |`
          lines.push(
            [row(cells[0]!), `|${' --- |'.repeat(width)}`, ...cells.slice(1).map(row)].join('\n')
          )
        }
        break
      }
      case 'column_list':
      case 'column':
      case 'synced_block': {
        const inner = blocksToMarkdown(block.children ?? [], depth)
        unsupported.push(...inner.unsupported)
        if (inner.markdown) lines.push(inner.markdown)
        break
      }
      default:
        unsupported.push(block.type)
        lines.push(`${indent}> ⚠️ Bloco do Notion não convertido (${block.type}).`)
    }
  }
  const joined = lines.join(depth === 0 ? '\n\n' : '\n').replace(/\n{3,}/g, '\n\n')
  // Só o nível de cima apara as bordas: nos aninhados, a indentação da primeira linha importa.
  return { markdown: depth === 0 ? joined.trim() : joined.replace(/\s+$/, ''), unsupported }
}

/** Seção "critérios de aceite" (por título), se a página tiver. */
export function extractAcceptanceCriteria(markdown: string): string | null {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) =>
    /^#{1,3}\s+.*(crit[ée]rios? de aceit|acceptance criteria|definition of done)/i.test(l)
  )
  if (start < 0) return null
  const level = /^#+/.exec(lines[start]!)![0].length
  const end = lines.findIndex(
    (l, i) => i > start && /^#+\s/.test(l) && /^#+/.exec(l)![0].length <= level
  )
  const body = lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim()
  return body || null
}

export interface BriefingInput {
  /** ID do Notion (ORK-142); `null` em bancos sem a propriedade de ID. */
  displayId: string | null
  title: string
  url: string | null
  properties: { name: string; value: string }[]
  pageMarkdown: string
  unsupported: string[]
  project: { name: string; repo: string | null; branch: string; worktree: string }
  pr: { number: number; state: string; url: string } | null
}

/** Briefing em markdown (mostrado ao usuário antes de rodar; editável na hora). */
export function buildBriefing(input: BriefingInput): string {
  const criteria = extractAcceptanceCriteria(input.pageMarkdown)
  const props = input.properties.filter((p) => p.value.trim())
  const parts = [
    input.displayId ? `# ${input.displayId} — ${input.title}` : `# ${input.title}`,
    props.length ? props.map((p) => `- **${p.name}:** ${p.value}`).join('\n') : '',
    input.url ? `Página no Notion: ${input.url}` : '',
    '## Contexto',
    [
      `- Projeto: ${input.project.name}${input.project.repo ? ` (${input.project.repo})` : ''}`,
      `- Branch de trabalho: ${input.project.branch} (worktree isolado; não faça push nem abra PR)`,
      input.pr
        ? `- PR: #${input.pr.number} (${input.pr.state}) ${input.pr.url}`
        : '- PR: ainda não existe'
    ].join('\n'),
    criteria ? `## Critérios de aceite\n\n${criteria}` : '',
    '## Descrição da tarefa (Notion)',
    input.pageMarkdown || '_A página da tarefa está vazia._',
    input.unsupported.length
      ? `> Aviso: ${input.unsupported.length} bloco(s) do Notion não foram convertidos (${[
          ...new Set(input.unsupported)
        ].join(', ')}).`
      : ''
  ]
  return parts.filter(Boolean).join('\n\n') + '\n'
}
