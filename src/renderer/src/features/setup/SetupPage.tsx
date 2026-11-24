import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { FolderPlusIcon } from '../../components/icons'
import { OrkioLogo } from '../../components/OrkioLogo/OrkioLogo'
import { StatusToken } from '../../components/StatusToken'
import { connectionStatusText } from '../../lib/status-text'
import { BoardSettings } from '../board/BoardSettings'
import { ClaudeCodeCard } from '../claude/ClaudeCodeCard'
import { NotionConnectionCard } from '../integrations/NotionConnectionCard'
import { useConnection } from '../integrations/useConnection'
import { useClaudeStatus } from '../claude/useClaudeStatus'
import { useBoard } from '../board/useBoard'
import { NotionWorkspaceCard } from '../notion-workspace/NotionWorkspaceCard'
import { ProjectNotionSection } from '../notion-workspace/ProjectNotionSection'
import { useNotionWorkspace } from '../notion-workspace/useNotionWorkspace'
import { AddProjectPanel } from '../projects/AddProjectPanel'
import { useProjects } from '../projects/useProjects'
import { LoginPanel } from './LoginPanel'
import './setup.css'
import { setupPending, setupSteps, type SetupStep, type SetupStepId } from './setup-steps'
import type { BoardTaskRef } from '../../../../shared/overview'
import type { ProjectSelection, ProjectView } from '../../../../shared/projects'
import { StepCircle } from '../../components/StepCircle'

const WHY: Record<SetupStepId, string> = {
  github: 'O Orkio confere o repositório do projeto e acompanha branches, PRs e CI das tarefas.',
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
  const notion = useConnection('notion', { revalidate: true })
  const github = useConnection('github', { revalidate: true })
  const githubStatus = github.status
  const workspace = useNotionWorkspace(notion.key)
  // A pessoa instala/loga o Claude Code fora: relê a cada 5 s enquanto a tela está aberta.
  const claude = useClaudeStatus({ pollMs: 5000 }).status
  const projects = useProjects({ revalidate: true })
  const [createdId, setCreatedId] = useState<string | null>(null)
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
  const board = useBoard(project?.notionProject ? project.id : null)

  const steps = setupSteps({
    github: githubStatus,
    notion: notion.status,
    claude,
    project,
    workspace: workspace.status,
    board: board.view
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
          <StatusToken {...connectionStatusText(githubStatus)} />
        ) : (
          <LoginPanel github={github} onUseToken={onOpenIntegrations} />
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
        <div className="flex flex-col gap-3">
          {project && (
            <p className="text-sm text-foreground">
              Projeto atual: <code className="font-mono text-xs">{project.name}</code>{' '}
              <span className="font-mono text-xs text-subtle-foreground">
                ({project.localPath})
              </span>
            </p>
          )}
          {pickError && <Alert tone="danger">{pickError}</Alert>}
          <div className="flex">
            <Button variant={project ? 'outline' : 'default'} onClick={() => void pickFolder()}>
              <FolderPlusIcon />
              {project ? 'Adicionar outro projeto' : 'Escolher pasta'}
            </Button>
          </div>
        </div>
      )
      break
    case 'notion-data':
      content = (
        <div className="flex flex-col gap-4">
          <NotionWorkspaceCard
            workspace={workspace}
            notionStatus={notion.status}
            {...(notion.authOptions?.oauth ? { onReconnect: notion.authorize } : {})}
          />
          {project && workspace.status?.config && (
            <ProjectNotionSection
              project={project}
              workspace={workspace.status}
              onChanged={projects.refresh}
              onOpenIntegrations={onOpenIntegrations}
            />
          )}
          {!project && (
            <p className="text-xs text-muted-foreground">Escolha a pasta do projeto antes.</p>
          )}
        </div>
      )
      break
    case 'board':
      content = !project?.notionProject ? (
        <p className="text-xs text-muted-foreground">
          Vincule o projeto a uma página do Notion antes.
        </p>
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
              const r = await board.save(input)
              if (r.ok) setSelected(null)
              return r
            }}
            onCancel={undefined}
          />
        )
      ) : (
        <p className="text-xs text-muted-foreground">Carregando o quadro…</p>
      )
      break
    case 'first-task': {
      const cards = board.view?.cards.slice(0, 8) ?? []
      content =
        !project || cards.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma tarefa sua neste projeto ainda. Elas aparecem quando você for o responsável no
            Notion.
          </p>
        ) : (
          <ul
            aria-label="Suas tarefas"
            className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft bg-card"
          >
            {cards.map((c) => (
              <li key={c.taskId}>
                <button
                  type="button"
                  onClick={() => onOpenTask({ projectId: project.id, taskId: c.taskId })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
                >
                  <span className="w-16 shrink-0 font-mono text-xs text-subtle-foreground">
                    {c.displayId ?? 'Notion'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      break
    }
  }

  const next = steps[index + 1]
  return (
    <main className="orkio-intro" aria-labelledby="setup-title">
      <div className="orkio-intro__content flex">
        <div className="flex w-[320px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-soft px-7 py-10">
          <OrkioLogo variant="simple" withWordmark size={18} />
          <h1
            id="setup-title"
            className="mt-4 mb-1 font-display text-[22px] leading-snug font-light tracking-[0.04em] text-foreground"
          >
            {projectId ? 'Continuar configuração' : 'Vamos deixar tudo pronto'}
          </h1>
          <p data-testid="setup-pending" className="mb-[22px] text-sm text-muted-foreground">
            {pending === 0
              ? 'Tudo pronto.'
              : `${pending} ${pending === 1 ? 'passo falta' : 'passos faltam'}. Dá para parar e voltar depois.`}
          </p>
          <ul aria-label="Primeiros passos" className="flex flex-col gap-0.5">
            {steps.map((s, i) => (
              <StepItem
                key={s.id}
                step={s}
                number={i + 1}
                isSelected={s.id === step.id}
                onSelect={() => setSelected(s.id)}
              />
            ))}
          </ul>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div
            role="region"
            aria-label={step.title}
            className="flex max-w-[820px] flex-col gap-[18px] p-12"
          >
            <p className="font-mono text-2xs tracking-[0.04em] text-subtle-foreground">
              {`PASSO ${index + 1} DE ${steps.length}`}
            </p>
            <h2 className="text-[22px] leading-tight font-medium text-foreground">{step.title}</h2>
            <p className="max-w-[600px] text-sm text-muted-foreground">{LEAD[step.id]}</p>
            {content}
            <p
              data-testid="setup-why"
              className="border-l-2 border-brand px-3 py-1 text-[12.5px] text-muted-foreground"
            >
              Por que isso? {WHY[step.id]}
            </p>
            <div className="flex items-center gap-2">
              {step.state === 'done' && next && (
                <Button onClick={() => setSelected(next.id)}>Continuar</Button>
              )}
              {index > 0 && (
                <Button variant="outline" onClick={() => setSelected(steps[index - 1]!.id)}>
                  Voltar
                </Button>
              )}
              <Button variant="outline" className="ml-auto" onClick={onExit}>
                Fazer depois
              </Button>
            </div>
          </div>
        </div>
      </div>
      {splash && (
        <div
          className="orkio-intro__splash flex flex-col items-center justify-center"
          aria-hidden="true"
          onAnimationEnd={(e: React.AnimationEvent) => {
            if (e.target === e.currentTarget) setSplash(false)
          }}
        >
          <OrkioLogo variant="full" size={160} label="" className="orkio-intro__splash-logo" />
          <span className="orkio-intro__splash-word">ORKIO</span>
        </div>
      )}
    </main>
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
    step.state === 'done' ? 'feito' : step.state === 'current' ? 'agora' : 'a fazer'
  return (
    <li aria-label={`${number}. ${step.title}: ${stateLabel}`}>
      <button
        type="button"
        aria-current={isSelected ? 'step' : undefined}
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-3 rounded-lg px-2.5 py-[9px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60',
          isSelected ? 'bg-muted' : 'hover:bg-muted/50'
        )}
      >
        <StepCircle number={number} state={step.state} />
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              'text-sm',
              isSelected || step.state === 'current' ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {step.title}
          </span>
          <span className="truncate text-[11.5px] text-subtle-foreground">
            {step.summary ?? stateLabel}
          </span>
        </span>
      </button>
    </li>
  )
}
