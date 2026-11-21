import { useEffect, useState } from 'react'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { BacklogTaskDocument } from '../../../../shared/alva'
import { Alert } from '../../components/Alert'
import { MarkdownText } from '../../components/MarkdownText'
import { StatusToken } from '../../components/StatusToken'
import { plural } from '../../lib/format'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; linked: string | null; doc: BacklogTaskDocument | null }

/**
 * Spec, critérios e plano da task do Backlog.md vinculada, para ler antes de aprovar (só leitura;
 * o texto vem do arquivo no ambiente da tarefa, com segredos ocultados). `refreshKey` recarrega
 * (o fluxo muda o arquivo a cada passo).
 */
export function BacklogDocumentView({
  projectId,
  taskId,
  refreshKey = 0
}: {
  projectId: string
  taskId: string
  refreshKey?: number
}): React.JSX.Element {
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let active = true
    void window.orkio.alva
      .taskDocument(projectId, taskId)
      .then((r) => {
        if (!active) return
        setState(
          r.ok ? { phase: 'ready', ...r.value } : { phase: 'error', message: r.error.message }
        )
      })
      .catch(() => {
        if (active) setState({ phase: 'error', message: 'Não deu para ler a task do Backlog.' })
      })
    return () => {
      active = false
    }
  }, [projectId, taskId, refreshKey])

  if (state.phase === 'loading') return <Skeleton height={80} aria-label="Carregando a task" />
  if (state.phase === 'error') return <Alert tone="danger">{state.message}</Alert>
  if (!state.doc) {
    return (
      <Text type="supporting">
        {state.linked
          ? `Não achei o arquivo da task ${state.linked} no ambiente desta tarefa.`
          : 'Esta tarefa ainda não tem task no Backlog. O /spec cria.'}
      </Text>
    )
  }
  const { info, body, truncated } = state.doc
  return (
    <VStack gap={3} role="region" aria-label="Spec e plano">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Code>{info.id}</Code>
        <Text weight="semibold">{info.title}</Text>
        <StatusToken tone="neutral" label={info.status} />
        <Text type="supporting">
          critérios {info.criteria.done}/{info.criteria.total}
        </Text>
        {info.openQuestions > 0 && (
          <StatusToken
            tone="warning"
            label={plural(info.openQuestions, 'pergunta em aberto', 'perguntas em aberto')}
          />
        )}
      </HStack>
      {body ? (
        <MarkdownText text={body} />
      ) : (
        <Text type="supporting">A task ainda não tem texto.</Text>
      )}
      {truncated && (
        <Text type="supporting">
          O texto passou do limite e foi cortado. Abra o arquivo da task para ler o resto.
        </Text>
      )}
    </VStack>
  )
}
