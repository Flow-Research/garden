import { useId, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { Label } from '@garden/ui/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@garden/ui/components/ui/select'
import { Switch } from '@garden/ui/components/ui/switch'
import { useDevSettingsStore } from '../dev-settings-store'
import { SettingsPanel } from './settings-page-shell'

type ThemeValue = 'light' | 'dark' | 'system'

const themeOptions: ReadonlyArray<{
  value: ThemeValue
  label: string
  icon: LucideIcon
}> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/** Routed Preferences section: device theme and developer tools. */
export function PreferencesSettings() {
  return (
    <SettingsPanel className="divide-y py-0 sm:py-0">
      <PreferenceSection title="Appearance">
        <ThemeRow />
      </PreferenceSection>
      <PreferenceSection title="Developer">
        <DebugModeRow />
      </PreferenceSection>
    </SettingsPanel>
  )
}

function PreferenceSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="space-y-3 py-4 sm:py-5">
      <h2 id={titleId} className="text-xs font-medium text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function PreferenceRow({
  label,
  description,
  control,
}: {
  label: ReactNode
  description: ReactNode
  control: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 sm:items-center">
      <div className="min-w-0 flex-1 space-y-1">
        {label}
        {description}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function ThemeRow() {
  const { theme, setTheme } = useTheme()
  const labelId = useId()
  const descriptionId = useId()
  // next-themes reports no theme until it reads storage; show no option until then.
  const current = themeOptions.find((option) => option.value === theme)

  return (
    <PreferenceRow
      label={
        <h3 id={labelId} className="text-sm font-semibold">
          Theme
        </h3>
      }
      description={
        <p id={descriptionId} className="text-sm text-muted-foreground">
          Choose a theme for this device
        </p>
      }
      control={
        <Select<ThemeValue>
          value={current?.value ?? null}
          onValueChange={(value) => {
            if (value) setTheme(value)
          }}
        >
          <SelectTrigger
            className="w-32"
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
          >
            <SelectValue>
              {() => (current ? <ThemeOptionLabel {...current} /> : null)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            {themeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <ThemeOptionLabel {...option} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}

function ThemeOptionLabel({
  label,
  icon: Icon,
}: {
  label: string
  icon: LucideIcon
}) {
  return (
    <>
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      {label}
    </>
  )
}

function DebugModeRow() {
  const debugMode = useDevSettingsStore((s) => s.debugMode)
  const setDebugMode = useDevSettingsStore((s) => s.setDebugMode)
  const switchId = useId()
  const descriptionId = useId()

  return (
    <PreferenceRow
      label={
        <Label htmlFor={switchId} className="text-sm font-semibold">
          Debug mode
        </Label>
      }
      description={
        <div id={descriptionId} className="space-y-1.5 text-muted-foreground">
          <p className="text-sm">
            Show live debugging details in each agent chat.
          </p>
          <p className="text-xs leading-5">
            Includes Durable Object, session, VFS, and sandbox state.
          </p>
        </div>
      }
      control={
        <Switch
          id={switchId}
          aria-describedby={descriptionId}
          checked={debugMode}
          onCheckedChange={(checked) => setDebugMode(checked === true)}
        />
      }
    />
  )
}
