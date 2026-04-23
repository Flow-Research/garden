'use client'

import { Label } from '@garden/ui/components/ui/label'
import { Switch } from '@garden/ui/components/ui/switch'
import { useDevSettingsStore } from '../dev-settings-store'

export function DeveloperTab() {
  const debugMode = useDevSettingsStore((s) => s.debugMode)
  const setDebugMode = useDevSettingsStore((s) => s.setDebugMode)

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <header>
          <h2 className="text-base font-semibold">Developer</h2>
          <p className="text-sm text-muted-foreground">
            Tools for inspecting live agent state while building.
          </p>
        </header>

        <div className="flex items-start justify-between gap-6 border-t pt-4">
          <div className="space-y-1">
            <Label htmlFor="debug-mode" className="text-sm font-medium">
              Debug mode
            </Label>
            <p className="text-sm text-muted-foreground">
              Show a debug drawer on each agent chat tab with live Durable
              Object, session, VFS, and sandbox state.
            </p>
          </div>
          <Switch
            id="debug-mode"
            checked={debugMode}
            onCheckedChange={(checked) => setDebugMode(checked === true)}
          />
        </div>
      </section>
    </div>
  )
}
