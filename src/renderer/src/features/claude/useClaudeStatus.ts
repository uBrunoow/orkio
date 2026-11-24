import { useEffect } from 'react'
import { useSources } from '../../app/sources'
import { useSource } from '../../lib/ipc'
import type { ClaudeCodeStatus } from '../../../../shared/agent-run'

/**
 * Estado do Claude Code (instalado, versão, login), um só para o App: o "Verificar de novo" do
 * cartão atualiza o resumo de Integrações, os Primeiros passos e a lista lateral. `pollMs` relê
 * enquanto a tela está aberta (Primeiros passos: a pessoa instala/loga fora).
 */
export function useClaudeStatus({ pollMs }: { pollMs?: number } = {}): {
  status: ClaudeCodeStatus | null
  check(force: boolean): Promise<void>
} {
  const { claude } = useSources()
  const { value } = useSource(claude, '')
  // Relê ao abrir a tela (o main guarda o último resultado; junta-se a uma leitura em andamento).
  useEffect(() => {
    void claude.reload('')
  }, [claude])
  useEffect(() => {
    if (!pollMs) return
    const timer = setInterval(() => void claude.reload(''), pollMs)
    return () => clearInterval(timer)
  }, [claude, pollMs])
  return { status: value, check: (force) => claude.reload('', { force }) }
}
