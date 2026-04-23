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
      <aside className="flex w-56 shrink-0 flex-col gap-6 overflow-y-auto bg-muted/30 px-3 py-6">
        <TabsList
          variant="line"
          className="flex-col items-stretch gap-0.5 px-1"
        >
          <span className="px-2 pb-1 text-xs font-medium text-muted-foreground">
            Account
          </span>
          {accountTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}
          {extraAccountTabs?.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}

          <span className="truncate px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">
            {workspaceName ?? 'Workspace'}
          </span>
          {workspaceTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              <tab.icon className="h-4 w-4" />
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
