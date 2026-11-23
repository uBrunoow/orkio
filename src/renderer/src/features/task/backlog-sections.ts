/** Spec e plano da task do Backlog.md (abas Spec e Plano): separa no título do plano. */
const PLAN_HEADING = /^#{1,3}\s+(implementation plan|plano)\b.*$/im

export function splitBacklogBody(body: string): { spec: string; plan: string | null } {
  const match = PLAN_HEADING.exec(body)
  if (!match) return { spec: body.trim(), plan: null }
  return { spec: body.slice(0, match.index).trim(), plan: body.slice(match.index).trim() }
}
