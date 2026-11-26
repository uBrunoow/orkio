import { cn } from '@/lib/utils'
import {
  AgentsIcon,
  EditIcon,
  ReadIcon,
  SearchIcon,
  TerminalIcon,
  ToolIcon,
  type SvgIcon
} from '../../components/icons'
import { StatusToken } from '../../components/StatusToken'
import { verbOf, type StepCategory, type WorkStep } from './run-transcript'

/** Peças das chamadas de ferramenta, usadas na rodada de trabalho e no cartão dos subagentes. */
export const CATEGORY_ICON: Record<StepCategory, SvgIcon> = {
  command: TerminalIcon,
  edit: EditIcon,
  read: ReadIcon,
  search: SearchIcon,
  subagent: AgentsIcon,
  tool: ToolIcon
}

/** Lista de passos com a régua à esquerda. */
export const TOOLS_LIST =
  'mt-1.5 ml-[7px] flex flex-col gap-1 border-l border-border-soft py-0.5 pl-3'

export function StepRow({ step }: { step: WorkStep }): React.JSX.Element {
  const failed = step.state === 'failed'
  const verb = verbOf(step.tool)
  const StepIcon = CATEGORY_ICON[step.category]
  return (
    <div className="flex min-w-0 items-start gap-2">
      <StepIcon
        className={cn('mt-0.5 size-3.5', failed ? 'text-danger' : 'text-subtle-foreground')}
      />
      <p className={cn('min-w-0 flex-1 break-words', failed && 'text-foreground')}>
        <span className="font-sans">{verb}</span>
        {step.summary && <> {step.summary}</>}
      </p>
      {failed && <StatusToken tone="danger" label="falhou" className="font-sans" />}
      {step.state === 'running' && (
        <StatusToken tone="running" label="rodando" className="font-sans" />
      )}
    </div>
  )
}
