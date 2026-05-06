'use client'

import { Check, Circle, Loader2 } from 'lucide-react'
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from '@/components/ai-elements/plan'
import { TaskItem } from '@/components/ai-elements/task'
import { cn } from '@garden/ui/lib/utils'

export type RunPlanTodo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

export interface RunPlanCardProps {
  todos: RunPlanTodo[]
  /** Marks the plan as live so the in-progress label shimmers. */
  streaming?: boolean
}

export function RunPlanCard({ todos, streaming = false }: RunPlanCardProps) {
  const completed = todos.filter((t) => t.status === 'completed').length
  const total = todos.length
  const inProgress = todos.find((t) => t.status === 'in_progress')
  const allDone = completed === total
  const headline = inProgress?.activeForm ?? (allDone ? 'Plan complete' : 'Plan')
  const progressLabel = `${completed} of ${total} done`

  return (
    <Plan defaultOpen isStreaming={streaming && Boolean(inProgress)}>
      <PlanHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PlanTitle className="text-sm">{headline}</PlanTitle>
          <PlanDescription className="text-xs">{progressLabel}</PlanDescription>
        </div>
        <PlanAction>
          <PlanTrigger />
        </PlanAction>
      </PlanHeader>
      <PlanContent className="pb-3">
        <ul className="flex flex-col gap-1.5">
          {todos.map((todo, idx) => (
            <li
              key={`${idx}-${todo.content}`}
              className="flex items-start gap-2"
            >
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
                {todo.status === 'completed' ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : todo.status === 'in_progress' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />
                ) : (
                  <Circle className="h-3 w-3 text-muted-foreground/50" />
                )}
              </span>
              <TaskItem
                className={cn(
                  todo.status === 'completed' && 'line-through opacity-70',
                  todo.status === 'in_progress' && 'text-foreground',
                )}
              >
                {todo.status === 'in_progress' ? todo.activeForm : todo.content}
              </TaskItem>
            </li>
          ))}
        </ul>
      </PlanContent>
    </Plan>
  )
}
