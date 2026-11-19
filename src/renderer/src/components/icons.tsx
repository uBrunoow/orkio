/**
 * Ícones do Tabler (@tabler/icons-react) adaptados ao `Icon` da Astryx, que espera um
 * componente SVG simples. Importe ícones daqui, não direto do Tabler.
 */
import type { FunctionComponent, SVGProps } from 'react'
import {
  IconBrandGithub,
  IconBrandNotion,
  IconDatabase,
  IconExternalLink,
  IconFolderPlus,
  IconFolderSearch,
  IconFolders,
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
  IconArrowDown,
  IconPlus,
  IconPlayerPause,
  IconBolt,
  IconX,
  IconPlugConnected,
  IconRefresh,
  IconTrash,
  IconTerminal2,
  IconPlayerPlay,
  IconPlayerStop,
  IconCode,
  IconFileDiff,
  IconEraser,
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
export const PauseIcon = adapt(IconPlayerPause)
export const AutomationIcon = adapt(IconBolt)
export const TerminalIcon = adapt(IconTerminal2)
export const PlayIcon = adapt(IconPlayerPlay)
export const StopIcon = adapt(IconPlayerStop)
export const EditorIcon = adapt(IconCode)
export const DiffIcon = adapt(IconFileDiff)
export const CleanIcon = adapt(IconEraser)
