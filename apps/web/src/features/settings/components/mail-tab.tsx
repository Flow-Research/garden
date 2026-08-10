// State hierarchy adapts Cloudflare Agentic Inbox (Apache-2.0) and Zero (MIT).
// See docs/architecture/garden-mail-ui-sources.md and THIRD_PARTY_NOTICES.md.

import { AlertCircle, Mail, ShieldCheck } from 'lucide-react'
import { useWorkspaceId } from '@garden/app-state/hooks'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@garden/ui/components/ui/alert'
import { Button } from '@garden/ui/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@garden/ui/components/ui/empty'
import { Skeleton } from '@garden/ui/components/ui/skeleton'
import type { MailSettingsController } from '../mail-settings-controller'
import { useMailSettingsController } from '../mail-settings-controller'
import { MailDomainSettings } from './mail-domain-settings'
import { MailMailboxSettings } from './mail-mailbox-settings'

function MailSettingsLoading() {
  return (
    <div aria-label="Loading mail settings" className="space-y-12">
      {[0, 1].map((section) => (
        <section key={section} className="space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="overflow-hidden rounded-xl border">
            {[0, 1].map((row) => (
              <div key={row} className="flex gap-4 px-5 py-4 [&+&]:border-t">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * Settings composition boundary. The default controller intentionally reports
 * unavailable until an authenticated workspace RPC is supplied; the UI never
 * fills missing provisioning data with demo domains, actors, or mailboxes.
 */
export function MailTab({
  controller,
}: {
  controller?: MailSettingsController
}) {
  return controller ? (
    <MailTabContent controller={controller} />
  ) : (
    <ConnectedMailTab />
  )
}

function ConnectedMailTab() {
  const workspaceId = useWorkspaceId()
  const controller = useMailSettingsController(workspaceId)
  return <MailTabContent controller={controller} />
}

function MailTabContent({
  controller,
}: {
  controller: MailSettingsController
}) {
  const activeController = controller

  if (activeController.status === 'loading') return <MailSettingsLoading />

  if (activeController.status === 'unavailable') {
    return (
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Mail />
          </EmptyMedia>
          <EmptyTitle>Mail administration is not connected</EmptyTitle>
          <EmptyDescription>{activeController.reason}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (activeController.status === 'error') {
    return (
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="text-destructive">
            <AlertCircle />
          </EmptyMedia>
          <EmptyTitle>Mail settings could not be loaded</EmptyTitle>
          <EmptyDescription>{activeController.message}</EmptyDescription>
          {activeController.retry ? (
            <Button
              variant="outline"
              size="sm"
              onClick={activeController.retry}
            >
              Try again
            </Button>
          ) : null}
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-lg font-semibold">Mail</h1>
        <p className="text-sm text-muted-foreground">
          Company domains and collaborative mailboxes for people and agents.
        </p>
      </header>
      {!activeController.canManage ? (
        <Alert>
          <ShieldCheck />
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>
            Workspace administrators manage domains, mailboxes, and access.
          </AlertDescription>
        </Alert>
      ) : null}
      <MailDomainSettings controller={activeController} />
      <MailMailboxSettings controller={activeController} />
    </div>
  )
}
