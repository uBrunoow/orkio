import type { ORKIO_API } from '../../shared/ipc/api'
import type { ClaudeService } from '../claude/claude.service'
import type { RunService } from '../claude/run.service'
import type { HandoffService } from '../claude/handoff.service'
import type { Impl } from './register'

export function claudeHandlers(
  service: ClaudeService,
  runs: RunService,
  handoff: HandoffService
): Impl<typeof ORKIO_API.claude> {
  return {
    status: (options) => service.getStatus(options.force),
    state: (projectId, taskId) => service.state(projectId, taskId),
    taskPage: (projectId, taskId) => service.taskPage(projectId, taskId),
    prepare: (projectId, taskId) => service.prepare(projectId, taskId),
    start: (request) => service.start(request),
    send: (request) => service.send(request),
    cancel: (runId) => runs.cancel(runId),
    answerPermission: (runId, requestId, answer) => runs.answerPermission(runId, requestId, answer),
    answerQuestion: (runId, requestId, answers) => runs.answerQuestion(runId, requestId, answers),
    readLog: (runId) => runs.readLog(runId),
    cleanup: (projectId, taskId, force) => service.cleanup(projectId, taskId, force),
    openEditor: (projectId, taskId, editor) => service.openEditor(projectId, taskId, editor),
    openTerminal: (projectId, taskId) => service.openTerminal(projectId, taskId),
    diff: (projectId, taskId) => service.diff(projectId, taskId),
    branches: (projectId, taskId) => service.branches(projectId, taskId),
    linkBranch: (projectId, taskId, branch) => service.linkBranch(projectId, taskId, branch),
    unlinkBranch: (projectId, taskId, branch) => service.unlinkBranch(projectId, taskId, branch),
    catalog: (projectId, taskId) => service.catalog(projectId, taskId),
    artifacts: (projectId, taskId) => service.artifacts(projectId, taskId),
    attachArtifact: (projectId, taskId, path, runId) =>
      service.attachArtifact(projectId, taskId, path, runId),
    publishArtifact: (projectId, artifactId, mode) =>
      service.publishArtifact(projectId, artifactId, mode),
    // Erros esperados (`DomainError`) viram `Result` de falha no registro do IPC.
    continueInClaude: async (projectId, taskId) => ({
      ok: true,
      value: await handoff.start(projectId, taskId)
    }),
    reopenHandoff: async (projectId, taskId) => ({
      ok: true,
      value: await handoff.openTerminal(projectId, taskId)
    }),
    giveBack: async (projectId, taskId, mode) => {
      await handoff.giveBack(projectId, taskId, mode)
      return service.state(projectId, taskId)
    }
  }
}
