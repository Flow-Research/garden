import { CoreProvider } from '@garden/core/platform'
import { ThemeProvider } from '@garden/ui/components/common/theme-provider'
import { Toaster } from '@garden/ui/components/ui/sonner'
import { WebNavigationProvider } from '@/platform/navigation'

export function WebProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CoreProvider apiBaseUrl="" cookieAuth>
        <WebNavigationProvider>{children}</WebNavigationProvider>
      </CoreProvider>
      <Toaster />
    </ThemeProvider>
  )
}
