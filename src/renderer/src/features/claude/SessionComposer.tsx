import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { VStack } from '@astryxdesign/core/VStack'
import type { AgentBadge } from '../../../../shared/agent'
import type { CatalogCommand, TaskRunsState } from '../../../../shared/agent-run'
import { Alert } from '../../components/Alert'
import { SendIcon, StopIcon } from '../../components/icons'

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const SEND_HINT = `${IS_MAC ? '⌘' : 'Ctrl'}+Enter envia.`

/** Comandos do catálogo que começam com o que foi digitado depois da barra. */
export function matchCommands(
  commands: readonly CatalogCommand[],
  typed: string,
  limit = 6
): CatalogCommand[] {
  const q = typed.toLowerCase()
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q))
  const contains = commands.filter(
    (c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)
  )
  return [...starts, ...contains].slice(0, limit)
}

/**
 * Campo de mensagem da sessão da tarefa: continua a última sessão do Claude Code (`--resume`) ou
 * começa uma com o briefing do Notion. `/` sugere comandos do catálogo; Ctrl/Cmd+Enter envia.
 * Enquanto o Claude trabalha, o botão vira "Parar"; com um passo de fluxo rodando, fica bloqueado.
 */
export function SessionComposer({
  projectId,
  taskId,
  agent,
  state,
  flowRunning,
  autopilotStep = null,
  onSent,
  onNewSession
}: {
  projectId: string
  taskId: string
  agent: AgentBadge | null
  state: TaskRunsState | null
  /** Um passo de fluxo está rodando (ou vai começar sozinho): não dá para mandar mensagem. */
  flowRunning: boolean
  /** Passo que o piloto automático (fluxo) está rodando agora. */
  autopilotStep?: string | null
  onSent(state: TaskRunsState): void
  /** Abre o formulário completo (briefing editável, modo, comando, rodar como). */
  onNewSession(): void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogCommand[] | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  const activeRunId = state?.activeRunId ?? null
  const latest = state?.runs[0] ?? null
  const resumes = !!latest?.hasSession
  const who = agent?.name ?? 'o Claude Code'

  const slash = /^\/(\S*)$/.exec(text)
  const typed = slash ? slash[1]! : null
  useEffect(() => {
    if (typed === null || catalog !== null) return
    let active = true
    void window.orkio.claude.catalog(projectId, taskId).then((r) => {
      if (active) setCatalog(r.ok ? r.value.flatMap((g) => g.commands) : [])
    })
    return () => {
      active = false
    }
  }, [typed, catalog, projectId, taskId])
  const suggestions = useMemo(
    () => (typed !== null && catalog ? matchCommands(catalog, typed) : []),
    [typed, catalog]
  )

  const blocked = flowRunning
    ? `O piloto automático está rodando${autopilotStep ? ` “${autopilotStep}”` : ' um passo'}. Ele para quando precisar de você; aí você responde aqui.`
    : activeRunId
      ? 'Espere o Claude terminar o turno ou pare a execução.'
      : null

  const send = async (): Promise<void> => {
    const message = text.trim()
    if (!message || blocked || sending) return
    setSending(true)
    setError(null)
    const r = await window.orkio.claude.send({ projectId, taskId, text: message })
    setSending(false)
    if (r.ok) {
      setText('')
      onSent(r.value)
    } else {
      setError(r.error.message)
    }
  }
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })
  // A TextArea da Astryx não expõe onKeyDown: o atalho vai direto no elemento.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        void sendRef.current()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [])

  return (
    <VStack gap={2} role="group" aria-label="Mensagem para a sessão">
      {suggestions.length > 0 && (
        <List density="compact" aria-label="Comandos sugeridos">
          {suggestions.map((c) => (
            <Item
              as="li"
              key={c.name}
              label={<Code>/{c.name}</Code>}
              {...(c.description ? { description: c.description } : {})}
              onClick={() => {
                setText(`/${c.name} `)
                ref.current?.focus()
              }}
            />
          ))}
        </List>
      )}
      <HStack gap={2} vAlign="end">
        <StackItem size="fill">
          <TextArea
            ref={ref}
            label={`Mensagem para ${who}`}
            isLabelHidden
            placeholder={`Escreva para ${who}… ( / para comandos)`}
            value={text}
            onChange={setText}
            rows={1}
            isDisabled={!!blocked && !activeRunId}
            {...(blocked && !activeRunId ? { disabledMessage: blocked } : {})}
          />
        </StackItem>
        {activeRunId ? (
          <Button
            size="sm"
            variant="secondary"
            label="Parar"
            icon={<Icon icon={StopIcon} />}
            onClick={() => void window.orkio.claude.cancel(activeRunId)}
          />
        ) : (
          <Button
            size="sm"
            variant="primary"
            label="Enviar"
            icon={<Icon icon={SendIcon} />}
            isLoading={sending}
            isDisabled={!text.trim() || !!blocked}
            onClick={() => void send()}
          />
        )}
      </HStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <StackItem size="fill">
          <Text type="supporting" color="secondary" data-testid="session-context">
            {flowRunning
              ? `Piloto automático${autopilotStep ? `: ${autopilotStep}` : ''}. Quando ele parar ou pedir algo, responda aqui.`
              : activeRunId
                ? 'O Claude está trabalhando. A próxima mensagem continua desta sessão.'
                : resumes
                  ? `Continua a sessão${latest?.command ? ` de /${latest.command}` : ''} na pasta de trabalho da tarefa.`
                  : 'Começa uma sessão nova com o resumo da tarefa no Notion.'}
            {!activeRunId && !blocked ? ` ${SEND_HINT}` : ''}
          </Text>
        </StackItem>
        {!activeRunId && !flowRunning && (
          <Button size="sm" variant="ghost" label="Nova sessão…" onClick={onNewSession} />
        )}
      </HStack>
      {error && <Alert tone="danger">{error}</Alert>}
    </VStack>
  )
}
