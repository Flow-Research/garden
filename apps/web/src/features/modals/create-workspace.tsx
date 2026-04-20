'use client'

import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigation } from '../navigation'
import { useImmersiveMode } from '../platform'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { Input } from '@garden/ui/components/ui/input'
import { Label } from '@garden/ui/components/ui/label'
import { Button } from '@garden/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@garden/ui/components/ui/dialog'
import { Card, CardContent } from '@garden/ui/components/ui/card'
import { useCreateWorkspace } from '@garden/core/workspace/mutations'
import {
  WORKSPACE_SLUG_CONFLICT_ERROR,
  WORKSPACE_SLUG_FORMAT_ERROR,
  WORKSPACE_SLUG_REGEX,
  isWorkspaceSlugConflict,
  nameToWorkspaceSlug,
} from '../workspace/slug'
import { createLogger } from '@garden/core/logger'

const logger = createLogger('workspace.create')

export function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  // This modal is full-screen, so it covers the app titlebar. On macOS desktop
  // we hide the traffic lights for its lifetime so the Back button in the top-
  // left corner isn't stolen by the native controls' hit-test. No-op elsewhere.
  useImmersiveMode()

  const router = useNavigation()
  const createWorkspace = useCreateWorkspace()
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugServerError, setSlugServerError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: {
      name: '',
      slug: '',
    },
    onSubmit: async ({ value }) => {
      const name = value.name.trim()
      const slug = value.slug.trim()

      logger.info('submit.start', { name, slug })
      setSlugServerError(null)

      try {
        await createWorkspace.mutateAsync({ name, slug })
        logger.info('submit.success', { slug })
        onClose()
        router.push('/workspace')
      } catch (error) {
        logger.error('submit.error', error)
        if (isWorkspaceSlugConflict(error)) {
          setSlugServerError(WORKSPACE_SLUG_CONFLICT_ERROR)
          toast.error('Choose a different workspace URL')
          return
        }
        toast.error(error instanceof Error ? error.message : 'Failed to create workspace')
      }
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent
        finalFocus={false}
        showCloseButton={false}
        className="inset-0 flex h-full w-full max-w-none sm:max-w-none translate-0 flex-col items-center justify-center rounded-none bg-background ring-0 shadow-none"
      >
        {/* Top drag region — restores window-drag ability that the full-screen
            modal would otherwise swallow. Transparent; web browsers ignore the
            -webkit-app-region property, so this is safe cross-platform. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-10"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />

        <Button
          variant="ghost"
          size="sm"
          className="absolute top-12 left-12 text-muted-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={onClose}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex w-full max-w-md flex-col items-center gap-6">
          <div className="text-center">
            <DialogTitle className="text-2xl font-semibold">
              Create a new workspace
            </DialogTitle>
            <DialogDescription className="mt-2">
              Workspaces are shared environments where teams can work on
              projects and issues.
            </DialogDescription>
          </div>

          <Card className="w-full">
            <CardContent className="pt-6">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  logger.info('submit.attempt', {
                    canSubmit: form.state.canSubmit,
                    values: form.state.values,
                  })
                  void form.handleSubmit()
                }}
              >
                <form.Field
                  name="name"
                  validators={{
                    onChange: ({ value }) =>
                      value.trim().length > 0
                        ? undefined
                        : 'Workspace name is required',
                  }}
                >
                  {(field) => (
                    <div className="space-y-1.5">
                      <Label htmlFor={field.name}>Workspace Name</Label>
                      <Input
                        id={field.name}
                        autoFocus
                        type="text"
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          const nextName = event.target.value
                          field.handleChange(nextName)
                          if (!slugTouched) {
                            form.setFieldValue('slug', nameToWorkspaceSlug(nextName))
                            setSlugServerError(null)
                          }
                        }}
                        placeholder="My Workspace"
                      />
                      {field.state.meta.isTouched &&
                      field.state.meta.errors.length > 0 ? (
                        <p className="text-xs text-destructive">
                          {String(field.state.meta.errors[0])}
                        </p>
                      ) : null}
                    </div>
                  )}
                </form.Field>

                <form.Field
                  name="slug"
                  validators={{
                    onChange: ({ value }) => {
                      if (value.trim().length === 0) {
                        return 'Workspace URL is required'
                      }

                      return WORKSPACE_SLUG_REGEX.test(value)
                        ? undefined
                        : WORKSPACE_SLUG_FORMAT_ERROR
                    },
                  }}
                >
                  {(field) => (
                    <div className="space-y-1.5">
                      <Label htmlFor={field.name}>Workspace URL</Label>
                      <div className="flex items-center gap-0 rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
                        <span className="pl-3 text-sm text-muted-foreground select-none">
                          {typeof window !== 'undefined'
                            ? `${window.location.host}/`
                            : ''}
                        </span>
                        <Input
                          id={field.name}
                          type="text"
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            setSlugTouched(true)
                            setSlugServerError(null)
                            field.handleChange(event.target.value)
                          }}
                          placeholder="my-workspace"
                          className="border-0 shadow-none focus-visible:ring-0"
                        />
                      </div>
                      {slugServerError ? (
                        <p className="text-xs text-destructive">
                          {slugServerError}
                        </p>
                      ) : field.state.meta.isTouched &&
                        field.state.meta.errors.length > 0 ? (
                        <p className="text-xs text-destructive">
                          {String(field.state.meta.errors[0])}
                        </p>
                      ) : null}
                    </div>
                  )}
                </form.Field>

                <form.Subscribe
                  selector={(state) => ({
                    isSubmitting: state.isSubmitting,
                  })}
                >
                  {({ isSubmitting }) => (
                    <Button
                      className="w-full"
                      size="lg"
                      type="submit"
                      disabled={isSubmitting || createWorkspace.isPending}
                    >
                      {isSubmitting || createWorkspace.isPending
                        ? 'Creating...'
                        : 'Create workspace'}
                    </Button>
                  )}
                </form.Subscribe>
              </form>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}
