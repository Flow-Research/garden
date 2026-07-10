import { useState } from 'react'
import { ListTodo, ArrowRight, Bot, CheckCircle2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
} from '@garden/ui/components/ui/alert-dialog'
import { Button } from '@garden/ui/components/ui/button'
import { Checkbox } from '@garden/ui/components/ui/checkbox'

interface TodoAgentHintDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDismissPermanently: () => void
  onMoveToInProgress: () => void
}

export function TodoAgentHintDialog({
  open,
  onOpenChange,
  onDismissPermanently,
  onMoveToInProgress,
}: TodoAgentHintDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] !max-w-[480px] gap-0 overflow-hidden rounded-lg p-0">
        <TodoAgentHintContent
          onKeepInTodo={() => onOpenChange(false)}
          onDismissPermanently={onDismissPermanently}
          onMoveToInProgress={onMoveToInProgress}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface TodoAgentHintContentProps {
  onKeepInTodo: () => void
  onDismissPermanently: () => void
  onMoveToInProgress: () => void
}

export function TodoAgentHintContent({
  onKeepInTodo,
  onDismissPermanently,
  onMoveToInProgress,
}: TodoAgentHintContentProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const handleKeepInTodo = () => {
    if (dontShowAgain) onDismissPermanently()
    onKeepInTodo()
  }

  const handleMoveToInProgress = () => {
    if (dontShowAgain) onDismissPermanently()
    onMoveToInProgress()
  }

  return (
    <>
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Agent is queued in Todo</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              The assigned agent will wait while this issue is queued. Move it
              to In Progress when you want the agent to start.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 rounded-lg border bg-muted/35 p-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ListTodo className="size-4 shrink-0" />
            <span className="font-medium text-foreground">Todo</span>
            <span className="text-muted-foreground">
              keeps the agent queued
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <ArrowRight className="size-4 shrink-0" />
            <span className="font-medium text-foreground">In Progress</span>
            <span className="text-muted-foreground">starts the agent</span>
            <CheckCircle2 className="ml-auto size-4 shrink-0 text-primary" />
          </div>
        </div>
      </div>

      <div className="border-t bg-muted/25 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(next) => setDontShowAgain(next === true)}
            />
            <span className="truncate">Don&apos;t show this again</span>
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={handleKeepInTodo}
            >
              Keep in Todo
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={handleMoveToInProgress}
            >
              Move to In Progress
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
