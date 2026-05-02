import { CoreProvider } from '@garden/core/platform'
import { ThemeProvider } from '@garden/ui/components/common/theme-provider'
import { Toaster } from '@garden/ui/components/ui/sonner'
import { WebNavigationProvider } from '@/platform/navigation'
import { api, configureApi } from '@/lib/api'

export function WebProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CoreProvider api={api} configureApi={configureApi} apiBaseUrl="">
        <WebNavigationProvider>{children}</WebNavigationProvider>
      </CoreProvider>
      <Toaster />
    </ThemeProvider>
  )
}
