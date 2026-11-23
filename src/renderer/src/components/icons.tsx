/**
 * Ícones do Tabler (@tabler/icons-react) adaptados ao `Icon` da Astryx, que espera um
 * componente SVG simples. Importe ícones daqui, não direto do Tabler.
 */
import type { FunctionComponent, SVGProps } from 'react'
import {
  IconAlertCircle,
  IconCircleCheck,
  IconCircleDashed,
  IconSend,
  IconBrandGithub,
  IconBrandNotion,
  IconDatabase,
  IconExternalLink,
  IconFolderPlus,
  IconCopy,
  IconFolderSearch,
  IconSearch,
  IconFolders,
  IconRobot,
  IconGitBranch,
  IconGitPullRequest,
  IconLink,
  IconLinkOff,
  IconListCheck,
  IconLayoutKanban,
  IconLock,
  IconCloudUpload,
  IconSettings,
  IconArrowUp,
  IconPointFilled,
  IconBell,
  IconArrowDown,
  IconPlus,
  IconPlayerPause,
  IconBolt,
  IconX,
  IconList,
  IconUser,
  IconPencil,
  IconChevronLeft,
  IconChevronRight,
  IconPlugConnected,
  IconRefresh,
  IconTrash,
  IconTerminal2,
  IconPlayerPlay,
  IconPlayerStop,
  IconCode,
  IconFileDiff,
  IconEraser,
  IconRoute,
  IconAdjustmentsHorizontal,
  IconSelector,
  IconArrowsMaximize,
  IconArrowLeft,
  IconMessage,
  IconShieldCheck,
  IconHelpCircle,
  IconFlag,
  IconInfoCircle,
  IconTool,
  IconFileText,
  IconLayoutDashboard,
  type Icon as TablerIcon,
  type IconProps as TablerIconProps
} from '@tabler/icons-react'

export type SvgIcon = FunctionComponent<SVGProps<SVGSVGElement>>

function adapt(TablerComponent: TablerIcon): SvgIcon {
  const Adapted: SvgIcon = (props) => (
    <TablerComponent {...(props as TablerIconProps)} stroke={1.75} aria-hidden="true" />
  )
  Adapted.displayName = TablerComponent.displayName ?? 'TablerIcon'
  return Adapted
}

export const GitHubLogo = adapt(IconBrandGithub)
export const NotionLogo = adapt(IconBrandNotion)
export const ExternalLinkIcon = adapt(IconExternalLink)
export const FolderPlusIcon = adapt(IconFolderPlus)
export const FolderSearchIcon = adapt(IconFolderSearch)
export const ProjectsIcon = adapt(IconFolders)
export const IntegrationsIcon = adapt(IconPlugConnected)
export const TrashIcon = adapt(IconTrash)
export const DatabaseIcon = adapt(IconDatabase)
export const LinkIcon = adapt(IconLink)
export const UnlinkIcon = adapt(IconLinkOff)
export const TasksIcon = adapt(IconListCheck)
export const RefreshIcon = adapt(IconRefresh)
export const GitBranchIcon = adapt(IconGitBranch)
export const PullRequestIcon = adapt(IconGitPullRequest)
export const BoardIcon = adapt(IconLayoutKanban)
export const LockIcon = adapt(IconLock)
export const SyncIcon = adapt(IconCloudUpload)
export const SettingsIcon = adapt(IconSettings)
export const ArrowUpIcon = adapt(IconArrowUp)
export const ArrowDownIcon = adapt(IconArrowDown)
export const PlusIcon = adapt(IconPlus)
export const CloseIcon = adapt(IconX)
export const ListIcon = adapt(IconList)
export const UserIcon = adapt(IconUser)
export const EditIcon = adapt(IconPencil)
export const ColumnCollapseIcon = adapt(IconChevronLeft)
export const ColumnExpandIcon = adapt(IconChevronRight)
export const PauseIcon = adapt(IconPlayerPause)
export const AutomationIcon = adapt(IconBolt)
export const TerminalIcon = adapt(IconTerminal2)
export const PlayIcon = adapt(IconPlayerPlay)
export const StopIcon = adapt(IconPlayerStop)
export const EditorIcon = adapt(IconCode)
export const DiffIcon = adapt(IconFileDiff)
export const CleanIcon = adapt(IconEraser)
export const AgentsIcon = adapt(IconRobot)
export const FlowsIcon = adapt(IconRoute)
export const StagesIcon = adapt(IconAdjustmentsHorizontal)
export const SwitchIcon = adapt(IconSelector)
export const ExpandIcon = adapt(IconArrowsMaximize)
export const BackIcon = adapt(IconArrowLeft)
export const MessageIcon = adapt(IconMessage)
export const PermissionIcon = adapt(IconShieldCheck)
export const QuestionIcon = adapt(IconHelpCircle)
export const FinishIcon = adapt(IconFlag)
export const InfoIcon = adapt(IconInfoCircle)
export const ToolIcon = adapt(IconTool)
export const ReadIcon = adapt(IconFileText)
export const OverviewIcon = adapt(IconLayoutDashboard)
/** Ponto de estado (StatusToken). */
export const BellIcon = adapt(IconBell)
export const DotIcon = adapt(IconPointFilled)

/** Marca do Claude (estrela de raios), desenhada em currentColor. */
/** Símbolo oficial do Claude (cor herdada do contexto, como as logos do Notion e do GitHub). */
export const ClaudeLogo: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
  </svg>
)
ClaudeLogo.displayName = 'ClaudeLogo'
export const SearchIcon = adapt(IconSearch)
export const SendIcon = adapt(IconSend)
export const DoneIcon = adapt(IconCircleCheck)
export const TodoIcon = adapt(IconCircleDashed)
export const ProblemIcon = adapt(IconAlertCircle)
export const CopyIcon = adapt(IconCopy)

/** Visão geral com um ponto de atenção (há algo esperando você); a coluna de ícones não mostra contador. */
export const OverviewAttentionIcon: SvgIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <OverviewIcon width={24} height={24} />
    <circle cx="19" cy="5" r="4" fill="var(--color-accent)" />
  </svg>
)
OverviewAttentionIcon.displayName = 'OverviewAttentionIcon'

/** Ponto de estado colorido pelo tema (itens da lista lateral, onde o ícone não recebe cor). */
function toneDot(color: string, name: string): SvgIcon {
  const Dot: SvgIcon = (props) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="4" fill={color} />
    </svg>
  )
  Dot.displayName = name
  return Dot
}

export const TONE_DOT_ICONS = {
  success: toneDot('var(--color-success)', 'SuccessDot'),
  warning: toneDot('var(--color-warning)', 'WarningDot'),
  danger: toneDot('var(--color-error)', 'DangerDot'),
  running: toneDot('var(--color-accent)', 'RunningDot'),
  neutral: toneDot('var(--color-text-secondary)', 'NeutralDot')
} as const
