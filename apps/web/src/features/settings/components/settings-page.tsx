'use client'

import React from 'react'
import { Bug, User, Palette, Settings, Users } from 'lucide-react'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@garden/ui/components/ui/tabs'
import { useWorkspaceStore } from '@garden/core/workspace'
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
  /** Initial tab to show; defaults to "profile". */
  defaultTab?: string
}

export function SettingsPage({
  extraAccountTabs,
  defaultTab = 'profile',
}: SettingsPageProps = {}) {
  const workspaceName = useWorkspaceStore((s) => s.workspace?.name)

  return (
    <Tabs
      defaultValue={defaultTab}
      orientation="vertical"
      className="min-h-0 flex-1 gap-0"
    >
      {/* Left nav */}
      <aside className="flex w-64 shrink-0 flex-col gap-6 overflow-y-auto bg-muted/30 px-4 py-6">
        <TabsList
          variant="line"
          className="w-full flex-col items-stretch gap-1 px-1"
        >
          <span className="px-3 pb-1 text-xs font-semibold tracking-[0.02em] text-muted-foreground">
            Account
          </span>
          {accountTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="min-h-11 w-full cursor-pointer justify-start gap-3 rounded-xl px-3 py-2 text-[0.95rem] font-medium text-foreground/70 hover:bg-background/70 hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-sm data-active:after:opacity-0 dark:data-active:bg-background/80"
            >
              <tab.icon className="size-[18px]" />
              {tab.label}
            </TabsTrigger>
          ))}
          {extraAccountTabs?.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="min-h-11 w-full cursor-pointer justify-start gap-3 rounded-xl px-3 py-2 text-[0.95rem] font-medium text-foreground/70 hover:bg-background/70 hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-sm data-active:after:opacity-0 dark:data-active:bg-background/80"
            >
              <tab.icon className="size-[18px]" />
              {tab.label}
            </TabsTrigger>
          ))}

          <span className="truncate px-3 pt-5 pb-1 text-xs font-semibold tracking-[0.02em] text-muted-foreground">
            {workspaceName ?? 'Workspace'}
          </span>
          {workspaceTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="min-h-11 w-full cursor-pointer justify-start gap-3 rounded-xl px-3 py-2 text-[0.95rem] font-medium text-foreground/70 hover:bg-background/70 hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-sm data-active:after:opacity-0 dark:data-active:bg-background/80"
            >
              <tab.icon className="size-[18px]" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </aside>

      {/* Right content */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-10 py-10">
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
