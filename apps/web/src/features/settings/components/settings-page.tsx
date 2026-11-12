import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Bug,
  User,
  Palette,
  Settings,
  Users,
  UsersRound,
} from 'lucide-react'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@garden/ui/components/ui/tabs'
import { useAuthStore } from '@garden/app-state/auth'
import { useWorkspaceStore } from '@garden/app-state/workspace'
import { useIsMobile } from '@garden/ui/hooks/use-mobile'
import { cn } from '@garden/ui/lib/utils'
import { memberListOptions } from '@/lib/workspace/queries'
import { useSettingsDialogStore } from '../settings-dialog-store'
import { AccountTab } from './account-tab'
import { AppearanceTab } from './appearance-tab'
import { DeveloperTab } from './developer-tab'
import { WorkspaceTab } from './workspace-tab'
import { MembersTab } from './members-tab'

const accountTabs = [
  { value: 'profile', label: 'Account', icon: User },
  { value: 'appearance', label: 'Appearance', icon: Palette },
  { value: 'developer', label: 'Developer', icon: Bug },
]

const workspaceTabs = [
  { value: 'workspace', label: 'General', icon: Settings },
  { value: 'members', label: 'Members', icon: Users },
]

export interface ExtraSettingsTab {
  value: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  content: React.ReactNode
}

interface SettingsPageProps {
  /** Additional tabs injected by platform (e.g. desktop daemon settings) */
  extraAccountTabs?: ExtraSettingsTab[]
  /** The selected tab. Without it, the page manages its own tab, starting on Account. */
  value?: string
  onValueChange?: (value: string) => void
}

const TAB_TRIGGER_CLASS =
  'min-h-11 cursor-pointer justify-start gap-3 rounded-xl px-3 py-2 text-[0.95rem] font-medium text-foreground/70 hover:bg-background/70 hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-sm data-active:after:opacity-0 dark:data-active:bg-background/80'

export function SettingsPage({
  extraAccountTabs,
  value,
  onValueChange,
}: SettingsPageProps = {}) {
  const workspaceName = useWorkspaceStore((s) => s.workspace?.name)
  const canManageTeams = useCanManageWorkspace()
  // A fixed 256px nav column left almost no room on a phone; below md the
  // nav becomes a scrolling row of tabs above the content.
  const isMobile = useIsMobile()
  const triggerClass = cn(TAB_TRIGGER_CLASS, isMobile ? 'shrink-0' : 'w-full')
  const groupLabelClass = cn(
    'px-3 pb-1 text-xs font-semibold tracking-[0.02em] text-muted-foreground',
    isMobile && 'sr-only',
  )

  return (
    <Tabs
      value={value}
      defaultValue={value === undefined ? 'profile' : undefined}
      onValueChange={(next) => onValueChange?.(String(next))}
      orientation={isMobile ? 'horizontal' : 'vertical'}
      className="min-h-0 flex-1 gap-0"
    >
      {/* Left nav */}
      <aside
        className={cn(
          'flex shrink-0 flex-col overflow-y-auto bg-muted/30',
          isMobile ? 'px-2 py-2' : 'w-64 gap-6 px-4 py-6',
        )}
      >
        <TabsList
          variant="line"
          className={cn(
            'gap-1 px-1',
            isMobile
              ? 'w-full flex-row justify-start overflow-x-auto group-data-[orientation=horizontal]/tabs:h-auto'
              : 'w-full flex-col items-stretch',
          )}
        >
          <span className={groupLabelClass}>Account</span>
          {accountTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={triggerClass}
            >
              <tab.icon className="size-[18px]" />
              {tab.label}
            </TabsTrigger>
          ))}
          {extraAccountTabs?.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={triggerClass}
            >
              <tab.icon className="size-[18px]" />
              {tab.label}
            </TabsTrigger>
          ))}

          <span
            className={cn(groupLabelClass, 'truncate', !isMobile && 'pt-5')}
          >
            {workspaceName ?? 'Workspace'}
          </span>
          {workspaceTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={triggerClass}
            >
              <tab.icon className="size-[18px]" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {canManageTeams ? (
          <TeamsSettingsLink
            className={cn(triggerClass, isMobile ? 'mt-1' : '-mt-5 mx-1')}
          />
        ) : null}
      </aside>

      {/* Right content */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-10 md:py-10">
          <TabsContent value="profile">
            <AccountTab />
          </TabsContent>
          <TabsContent value="appearance">
            <AppearanceTab />
          </TabsContent>
          <TabsContent value="developer">
            <DeveloperTab />
          </TabsContent>
          <TabsContent value="workspace">
            <WorkspaceTab />
          </TabsContent>
          <TabsContent value="members">
            <MembersTab />
          </TabsContent>
          {extraAccountTabs?.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              {tab.content}
            </TabsContent>
          ))}
        </div>
      </div>
    </Tabs>
  )
}

/**
 * Whether the signed-in user is a workspace owner or admin, read from the
 * workspace member list the Teams overview already uses. It is false while
 * the list loads, so the Teams entry never flashes for a member. This is a
 * display rule only; the Teams API enforces access on the server.
 */
function useCanManageWorkspace() {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id)
  const userId = useAuthStore((s) => s.user?.id)
  const { data: members } = useQuery({
    ...memberListOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  })
  const role = members?.find((member) => member.user_id === userId)?.role
  return role === 'owner' || role === 'admin'
}

/**
 * The Settings entry for Teams. Teams admin already lives at `/teams`, so this
 * entry opens that page instead of copying it into Settings (Teams admin spec,
 * section 5.1). Settings closes first so the Teams page never mounts under an
 * open modal.
 */
function TeamsSettingsLink({ className }: { className: string }) {
  const navigate = useNavigate()
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings)

  return (
    <button
      type="button"
      className={cn('flex items-center', className)}
      onClick={() => {
        closeSettings()
        void navigate({ to: '/teams' })
      }}
    >
      <UsersRound className="size-[18px]" />
      Teams
      <ArrowUpRight className="ml-auto size-4 text-muted-foreground" />
    </button>
  )
}
