import { createContext, useContext } from 'react'

export type TaskActivityMap = Record<string, { waiting: string | null; running: string | null }>

const TaskActivityContext = createContext<TaskActivityMap>({})

export const TaskActivityProvider = TaskActivityContext.Provider

export function useTaskActivity(taskId: string): {
  waiting: string | null
  running: string | null
} {
  return useContext(TaskActivityContext)[taskId] ?? { waiting: null, running: null }
}
