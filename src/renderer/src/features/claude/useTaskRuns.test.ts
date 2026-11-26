import { describe, expect, it } from 'vitest'
import type { RunLogEvent } from '../../../../shared/agent-run'
import { mergeLiveLog } from './useTaskRuns'

const info = (text: string): RunLogEvent => ({ kind: 'info', text })
const queued: RunLogEvent = { kind: 'status', status: 'queued' }
const running: RunLogEvent = { kind: 'status', status: 'running' }

describe('mergeLiveLog', () => {
  it('mantém o evento que chegou ao vivo depois da leitura do arquivo', () => {
    const file = [queued, running]
    const live = [running, info('Mensagem editada: a conversa voltou até antes dela')]
    expect(mergeLiveLog(file, live)).toEqual([
      queued,
      running,
      info('Mensagem editada: a conversa voltou até antes dela')
    ])
  })

  it('não duplica quando o arquivo já tem tudo o que chegou ao vivo', () => {
    const file = [queued, running, info('a')]
    expect(mergeLiveLog(file, [running, info('a')])).toEqual(file)
  })

  it('sem sobreposição, junta no fim', () => {
    expect(mergeLiveLog([queued], [running, info('a')])).toEqual([queued, running, info('a')])
  })

  it('sem eventos ao vivo, é o arquivo', () => {
    expect(mergeLiveLog([queued, running], [])).toEqual([queued, running])
  })
})
