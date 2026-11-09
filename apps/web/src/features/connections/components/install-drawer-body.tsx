import { useState } from 'react'
import { Option, Schema } from 'effect'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { previewIntegrationTools, type RegistryEntry } from '@/lib/api/executor'
import { ExecutorIntegrationSource } from '@/lib/executor-contract'
import { executorRegistryKeys } from '../queries'
import { Button } from '@garden/ui/components/ui/button'
import {
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@garden/ui/components/ui/drawer'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@garden/ui/components/ui/tabs'
import { Spinner } from '@garden/ui/components/ui/spinner'
import { sourceLabel, sourceDescription } from './connection-helpers'
import { ProviderIcon } from './provider-icon'
import { PreviewToolList, PreviewToolSkeleton } from './tool-list'

export function InstallDrawerBody({
  entry,
  pending,
  onInstall,
  onClose,
}: {
  entry: RegistryEntry
  pending: boolean
  onInstall: (source: ExecutorIntegrationSource) => void
  onClose: () => void
}) {
  const [source, setSource] = useState<ExecutorIntegrationSource>(
    entry.sources[0],
  )
  const previewQuery = useQuery({
    queryKey: executorRegistryKeys.toolPreview(entry.providerId, source),
    queryFn: () => previewIntegrationTools({ entry, source }),
    staleTime: 10 * 60_000,
  })

  return (
    <>
      <DrawerHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <ProviderIcon icon={entry.icon} className="size-5 shrink-0" />
            <DrawerTitle className="truncate">{entry.name}</DrawerTitle>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0 text-muted-foreground"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
        <DrawerDescription>{entry.description}</DrawerDescription>
      </DrawerHeader>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <section>
          <h3 className="text-sm font-semibold text-foreground">Tool source</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which server-owned source Garden should install.
          </p>
          <Tabs
            value={source}
            onValueChange={(value) => {
              const decoded = Schema.decodeUnknownOption(
                ExecutorIntegrationSource,
              )(value)
              if (
                Option.isSome(decoded) &&
                entry.sources.includes(decoded.value)
              ) {
                setSource(decoded.value)
              }
            }}
            className="mt-4"
          >
            <TabsList
              variant="line"
              className="max-w-full justify-start overflow-x-auto"
              aria-label="Tool source"
            >
              {entry.sources.map((candidate) => (
                <TabsTrigger key={candidate} value={candidate}>
                  {sourceLabel(candidate)}
                </TabsTrigger>
              ))}
            </TabsList>
            {entry.sources.map((candidate) => (
              <TabsContent
                key={candidate}
                value={candidate}
                className="pt-4 text-sm text-muted-foreground"
              >
                {sourceDescription(candidate)}
              </TabsContent>
            ))}
          </Tabs>

          <Button
            className="mt-5"
            disabled={
              pending || previewQuery.data?.status === 'definition_missing'
            }
            onClick={() => onInstall(source)}
          >
            {pending ? <Spinner aria-hidden="true" /> : null}
            {previewQuery.data?.status === 'definition_missing'
              ? `${sourceLabel(source)} definition unavailable`
              : `Install ${sourceLabel(source)}`}
          </Button>
        </section>

        <section className="mt-8 border-t pt-6" aria-live="polite">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-semibold text-foreground">Tools</h3>
            {Option.getOrNull(previewQuery.data?.toolCount ?? Option.none()) !==
            null ? (
              <span className="text-xs text-muted-foreground">
                {Option.getOrNull(
                  previewQuery.data?.toolCount ?? Option.none(),
                )}
              </span>
            ) : null}
          </div>
          {previewQuery.isLoading ? <PreviewToolSkeleton /> : null}
          {previewQuery.isError ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Garden could not load this tool preview. Try the source again.
            </p>
          ) : null}
          {previewQuery.data ? (
            <>
              {previewQuery.data.tools.length > 0 ? (
                <PreviewToolList tools={previewQuery.data.tools} />
              ) : (
                <p className="mt-3 max-w-prose text-sm text-muted-foreground">
                  {previewQuery.data.message}
                </p>
              )}
            </>
          ) : null}
        </section>
      </div>
    </>
  )
}
