import { createContext, useContext } from 'react'
import { NO_ACTIVITY, type TaskActivity } from '../overview/task-activity'

export type TaskActivityMap = ReadonlyMap<string, TaskActivity>

const TaskActivityContext = createContext<TaskActivityMap>(new Map())

export const TaskActivityProvider = TaskActivityContext.Provider

export function useTaskActivity(taskId: string): TaskActivity {
  return useContext(TaskActivityContext).get(taskId) ?? NO_ACTIVITY
}
