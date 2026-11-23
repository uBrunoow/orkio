import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'
import type {
  BoardTaskRef,
  BoardView,
  ConnectionStatus,
  ProjectSelection,
  ProjectView
} from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { DoneIcon, FolderPlusIcon, TodoIcon } from '../../components/icons'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { StatusToken } from '../../components/StatusToken'
import { BoardSettings } from '../board/BoardSettings'
import { ClaudeCodeCard } from '../claude/ClaudeCodeCard'
import { NotionConnectionCard } from '../integrations/NotionConnectionCard'
import { useGitHubConnection } from '../integrations/useGitHubConnection'
import { useNotionConnection } from '../integrations/useNotionConnection'
import { NotionWorkspaceCard } from '../notion-workspace/NotionWorkspaceCard'
import { ProjectNotionSection } from '../notion-workspace/ProjectNotionSection'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { AddProjectPanel } from '../projects/AddProjectPanel'
import { useProjects } from '../projects/useProjects'
import { LoginPanel } from '../welcome/LoginPanel'
import '../welcome/welcome.css'
import { setupPending, setupSteps, type SetupStep, type SetupStepId } from './setup-steps'

const WHY: Record<SetupStepId, string> = {
  github:
    'O Orkio acompanha branches, PRs e CI das tarefas. Opcional: dá para seguir sem e conectar depois.',
  notion: 'As tarefas vêm do Notion. O Orkio só escreve o status quando você move um card.',
  claude:
    'Quem trabalha nas tarefas é o seu Claude Code, com o seu login. O Orkio não guarda chave da Anthropic.',
  folder: 'O Orkio trabalha numa cópia isolada (worktree) da pasta. Os seus arquivos não mudam.',
  'notion-data':
    'O Orkio lê só as tarefas deste projeto em que você é o responsável. Nada é gravado no Notion aqui.',
  board:
    'Cada coluna corresponde a um status do Notion. As automações padrão já vêm ligadas: a tarefa anda sozinha com o GitHub.',
  'first-task': 'A tarefa abre com as fases no topo, a conversa com o agente e o que falta de você.'
}

const LEAD: Record<SetupStepId, string> = {
  github: 'Entre com a sua conta do GitHub.',
  notion: 'Conecte o workspace do Notion onde ficam seus projetos e tarefas.',
  claude: 'Confira se o Claude Code está instalado e com login neste computador.',
  folder: 'Escolha a pasta de um repositório clonado. O repositório do GitHub é detectado sozinho.',
  'notion-data':
    'Escolha os bancos de Projetos e Tarefas (já sugerimos pelos nomes) e a página deste projeto.',
  board: 'As colunas e os status sugeridos estão abaixo. Confira e crie o quadro.',
  'first-task': 'Tudo pronto. Escolha uma tarefa para começar.'
}

function connectionKey(status: ConnectionStatus | null): string | null {
  if (status === null || status.state === 'connecting') return null
  return status.state === 'connected' ? `connected:${status.connectedAt}` : status.state
}

/** Estado do Claude Code (relê a cada 5 s enquanto a tela está aberta: a pessoa instala/loga fora). */
function useClaude(): ClaudeCodeStatus | null {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.orkio.claude
        .status()
        .then((s) => alive && setStatus(s))
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return status
}

/** Quadro do projeto (para saber se já existe e para criá-lo aqui). */
function useProjectBoard(projectId: string | null): {
  view: BoardView | null
  reload(): void
} {
  const [state, setState] = useState<{ projectId: string; view: BoardView } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!projectId) return
    let alive = true
    void window.orkio.board
      .get(projectId)
      .then((r) => {
        if (alive && r.ok) setState({ projectId, view: r.value })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [projectId, tick])
  return {
    view: state && state.projectId === projectId ? state.view : null,
    reload: () => setTick((n) => n + 1)
  }
}

/**
 * Primeiros passos (reestruturação): um caminho só, do zero até a primeira tarefa. Os passos vêm
 * do estado real; o conteúdo de cada passo reaproveita os fluxos que já existem (login do GitHub,
 * conexão do Notion, Claude Code, adicionar projeto, bancos e vínculo, criar o quadro).
 */
export function SetupPage({
  projectId = null,
  onExit,
  onOpenTask,
  onOpenIntegrations
}: {
  /** Com projeto: só os passos que faltam para ele ("Continuar configuração"). */
  projectId?: string | null
  /** "Fazer depois" e o fim do caminho sem abrir tarefa. */
  onExit(): void
  onOpenTask(ref: BoardTaskRef): void
  /** "Usar um token": a conexão por token fica em Configurações › Integrações. */
  onOpenIntegrations(): void
}): React.JSX.Element {
  const notion = useNotionConnection()
  const github = useGitHubConnection()
  const [githubOverride, setGithubOverride] = useState<ConnectionStatus | null>(null)
  const githubStatus = githubOverride ?? github.status
  const workspace = useNotionWorkspace(connectionKey(notion.status))
  const claude = useClaude()
  const projects = useProjects()
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [githubSkipped, setGithubSkipped] = useState(false)
  const [selected, setSelected] = useState<SetupStepId | null>(null)
  const [selection, setSelection] = useState<ProjectSelection | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  // Abertura animada (só na primeira vez, sem projeto); sai do DOM quando a animação termina.
  const [splash, setSplash] = useState(projectId === null)

  const project: ProjectView | null = useMemo(() => {
    const list = projects.projects ?? []
    return (
      list.find((p) => p.id === (createdId ?? projectId)) ?? (projectId ? null : (list[0] ?? null))
    )
  }, [projects.projects, createdId, projectId])
  const board = useProjectBoard(project?.notionProject ? project.id : null)

  const steps = setupSteps({
    github: githubStatus,
    githubSkipped,
    notion: notion.status,
    claude,
    project,
    workspace: workspace.status,
    boardConfigured: !!board.view?.config
  })
  const current = steps.find((s) => s.state === 'current') ?? steps[steps.length - 1]!
  const step = steps.find((s) => s.id === selected) ?? current
  const index = steps.indexOf(step)
  const pending = setupPending(steps)

  async function pickFolder(): Promise<void> {
    setPickError(null)
    const r = await projects.pickFolder()
    if (r.ok) setSelection(r.selection)
    else if (!r.cancelled) setPickError(r.error.message)
  }

  let content: React.ReactNode
  switch (step.id) {
    case 'github':
      content =
        githubStatus?.state === 'connected' ? (
          <StatusToken tone="success" label={`Conectado como ${step.summary ?? 'você'}`} />
        ) : (
          <LoginPanel
            oauth={github.authOptions?.oauth ?? false}
            onConnected={(s) => setGithubOverride(s)}
            onSkip={() => {
              setGithubSkipped(true)
              setSelected(null)
            }}
            onUseToken={onOpenIntegrations}
          />
        )
      break
    case 'notion':
      content = <NotionConnectionCard notion={notion} />
      break
    case 'claude':
      content = <ClaudeCodeCard />
      break
    case 'folder':
      content = selection ? (
        <AddProjectPanel
          key={selection.selectionId}
          selection={selection}
          onCreate={async (input) => {
            const r = await projects.create(input)
            if (r.ok) {
              setSelection(null)
              setCreatedId(r.project.id)
              setSelected(null)
            }
            return r
          }}
          onCancel={() => setSelection(null)}
        />
      ) : (
        <VStack gap={3}>
          {project && (
            <Text>
              Projeto atual: <Code>{project.name}</Code> ({project.localPath})
            </Text>
          )}
          {pickError && <Alert tone="danger">{pickError}</Alert>}
          <HStack>
            <Button
              variant={project ? 'secondary' : 'primary'}
              label={project ? 'Adicionar outro projeto' : 'Escolher pasta'}
              icon={<Icon icon={FolderPlusIcon} />}
              onClick={() => void pickFolder()}
            />
          </HStack>
        </VStack>
      )
      break
    case 'notion-data':
      content = (
        <VStack gap={4}>
          <NotionWorkspaceCard
            workspace={workspace}
            notionStatus={notion.status}
            {...(notion.authOptions?.oauth ? { onReconnect: notion.startOAuth } : {})}
          />
          {project && workspace.status?.config && (
            <ProjectNotionSection
              project={project}
              workspace={workspace.status}
              onChanged={projects.refresh}
              onOpenIntegrations={onOpenIntegrations}
            />
          )}
          {!project && <Text type="supporting">Escolha a pasta do projeto antes.</Text>}
        </VStack>
      )
      break
    case 'board':
      content = !project?.notionProject ? (
        <Text type="supporting">Vincule o projeto a uma página do Notion antes.</Text>
      ) : board.view ? (
        board.view.config ? (
          <StatusToken
            tone="success"
            label={`Quadro criado: ${board.view.config.stages.length} colunas`}
          />
        ) : (
          <BoardSettings
            view={board.view}
            onSave={async (input) => {
              const r = await window.orkio.board.save(project.id, input)
              if (r.ok) {
                board.reload()
                setSelected(null)
              }
              return r
            }}
            onCancel={undefined}
          />
        )
      ) : (
        <Text type="supporting">Carregando o quadro…</Text>
      )
      break
    case 'first-task': {
      const cards = board.view?.cards.slice(0, 8) ?? []
      content =
        !project || cards.length === 0 ? (
          <Text type="supporting">
            Nenhuma tarefa sua neste projeto ainda. Elas aparecem quando você for o responsável no
            Notion.
          </Text>
        ) : (
          <List hasDividers aria-label="Suas tarefas">
            {cards.map((c) => (
              <Item
                as="li"
                key={c.taskId}
                label={c.title}
                description={c.displayId ?? 'Tarefa do Notion'}
                onClick={() => onOpenTask({ projectId: project.id, taskId: c.taskId })}
              />
            ))}
          </List>
        )
      break
    }
  }

  const next = steps[index + 1]
  return (
    <VStack className="orkio-intro" role="main" aria-labelledby="setup-title">
      <HStack className="orkio-intro__content" vAlign="stretch">
        <VStack gap={2} padding={8} width="calc(var(--spacing-12) * 7)">
          <OrkioLogo variant="simple" withWordmark size={24} />
          <Heading level={1} id="setup-title">
            {projectId ? 'Continuar configuração' : 'Vamos deixar tudo pronto'}
          </Heading>
          <Text type="supporting" color="secondary" data-testid="setup-pending">
            {pending === 0
              ? 'Tudo pronto.'
              : `${pending} ${pending === 1 ? 'passo falta' : 'passos faltam'}. Dá para parar e voltar depois.`}
          </Text>
          <List aria-label="Primeiros passos" density="balanced">
            {steps.map((s, i) => (
              <StepItem
                key={s.id}
                step={s}
                number={i + 1}
                isSelected={s.id === step.id}
                onSelect={() => setSelected(s.id)}
              />
            ))}
          </List>
        </VStack>
        <StackItem size="fill">
          <ScrollableArea label="Passo atual" height="100%" padding={8}>
            <VStack
              gap={5}
              maxWidth="calc(var(--spacing-12) * 16)"
              role="region"
              aria-label={step.title}
            >
              <Text type="supporting" color="secondary">
                {`PASSO ${index + 1} DE ${steps.length}`}
              </Text>
              <Heading level={2}>{step.title}</Heading>
              <Text color="secondary">{LEAD[step.id]}</Text>
              {content}
              <Text type="supporting" color="secondary" data-testid="setup-why">
                Por que isso? {WHY[step.id]}
              </Text>
              <HStack gap={2} vAlign="center">
                {step.state === 'done' && next && (
                  <Button
                    variant="primary"
                    label="Continuar"
                    onClick={() => setSelected(next.id)}
                  />
                )}
                {index > 0 && (
                  <Button
                    variant="ghost"
                    label="Voltar"
                    onClick={() => setSelected(steps[index - 1]!.id)}
                  />
                )}
                <StackItem size="fill" />
                <Button variant="ghost" label="Fazer depois" onClick={onExit} />
              </HStack>
            </VStack>
          </ScrollableArea>
        </StackItem>
      </HStack>
      {splash && (
        <VStack
          className="orkio-intro__splash"
          hAlign="center"
          vAlign="center"
          aria-hidden="true"
          onAnimationEnd={(e: React.AnimationEvent) => {
            if (e.target === e.currentTarget) setSplash(false)
          }}
        >
          <OrkioLogo variant="full" size={160} label="" className="orkio-intro__splash-logo" />
          <Text className="orkio-intro__splash-word">ORKIO</Text>
        </VStack>
      )}
    </VStack>
  )
}

function StepItem({
  step,
  number,
  isSelected,
  onSelect
}: {
  step: SetupStep
  number: number
  isSelected: boolean
  onSelect(): void
}): React.JSX.Element {
  const stateLabel =
    step.state === 'done'
      ? 'feito'
      : step.state === 'skipped'
        ? 'pulado'
        : step.state === 'current'
          ? 'agora'
          : 'a fazer'
  return (
    <Item
      as="li"
      aria-label={`${number}. ${step.title}: ${stateLabel}`}
      label={`${number}. ${step.title}`}
      description={step.summary ?? stateLabel}
      isSelected={isSelected}
      startContent={
        <Icon
          icon={step.state === 'done' ? DoneIcon : TodoIcon}
          color={
            step.state === 'done' ? 'success' : step.state === 'current' ? 'accent' : 'tertiary'
          }
        />
      }
      onClick={onSelect}
    />
  )
}
