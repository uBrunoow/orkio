/**
 * "Continuar no Claude" (Fase 2): você assume a sessão do Claude Code da tarefa num terminal
 * (`claude --resume <sessão>`) para resolver na mão o que o Orkio não conseguiu (ex.: uma
 * permissão). Enquanto a sessão está com você, ela fica travada: nenhuma execução do Orkio roda na
 * tarefa. Você devolve com "O Claude continua o passo" ou "Passo feito".
 */

/** Como devolver: o Claude retoma o passo na mesma sessão, ou o passo conta como feito. */
export const HANDOFF_RETURNS = ['continue', 'done'] as const
export type HandoffReturn = (typeof HANDOFF_RETURNS)[number]

export interface HandoffView {
  projectId: string
  taskId: string
  /** A sessão retomada no terminal (o comando para copiar, se o terminal embutido faltar). */
  sessionId: string
  since: string
  /** Terminal embutido com o Claude rodando agora (`null` = fechado ou indisponível). */
  terminalId: string | null
  /** O fluxo parou num comando do Claude Code: "Passo feito" faz o fluxo seguir. */
  flowStep: boolean
}

export const HANDOFF_TEXT = {
  state: 'Com você no terminal',
  start: 'Continuar no Claude',
  startHint:
    'Pausa o Orkio e abre esta sessão do Claude Code num terminal, para você resolver na mão.',
  warning:
    'No terminal valem as configurações do seu Claude Code (~/.claude), não as regras do Orkio: push, GitHub e permissões ficam por sua conta.',
  continue: 'O Claude continua o passo',
  continueHint: 'Devolve a sessão; o Claude retoma de onde você parou, na mesma conversa.',
  done: 'Passo feito',
  doneHint: 'Devolve a sessão; o que você fez no terminal conta como o passo e o fluxo segue.',
  doneNoFlow: 'Devolver ao Orkio',
  /** Texto mandado ao Claude no "O Claude continua o passo". */
  continuePrompt:
    'Voltei do terminal: fiz algumas coisas direto nesta sessão. Confira o estado atual do ambiente e continue o passo de onde parou.'
} as const

/** O comando para rodar à mão (o mesmo que o terminal embutido roda). */
export function resumeCommand(sessionId: string): string {
  return `claude --resume ${sessionId}`
}
