/**
 * Remove segredos de textos que vão para o log da execução (`<userData>/runs/<id>.jsonl`) e para a
 * tela. Heurística conservadora: prefere esconder demais a vazar.
 */
const PATTERNS: RegExp[] = [
  /\b(ntn|secret)_[A-Za-z0-9]{16,}\b/g, // Notion
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, // Anthropic
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
]

/** NOME_COM_KEY/TOKEN/SECRET/PASSWORD = valor → NOME=[omitido]. */
const ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"']+)/gi

export function redactSecrets(text: string): string {
  // Atribuições primeiro (o valor inteiro some); depois os formatos conhecidos soltos no texto.
  let out = text.replace(ASSIGNMENT, (_m, name: string, sep: string) => `${name}${sep}[omitido]`)
  for (const p of PATTERNS) out = out.replace(p, '[segredo omitido]')
  return out
}

/** Arquivo de ambiente (.env, .env.local, …): o conteúdo nunca vai para o log. */
export function isEnvFile(path: string): boolean {
  return /(^|[/\\])\.env(\.[^/\\]*)?$/.test(path)
}

/** Ambiente do processo do Claude Code: tira credenciais que forçariam outra autenticação/vazariam. */
export function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    if (/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)$/.test(k)) continue
    if (/^(ELECTRON_|ORKIO_)/.test(k)) continue
    if (/^MAIN_VITE_/.test(k)) continue
    out[k] = v
  }
  return out
}
