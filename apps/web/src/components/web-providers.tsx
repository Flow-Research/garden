import { CoreProvider } from '@accelerate/core/platform'
import { ThemeProvider } from '@accelerate/ui/components/common/theme-provider'
import { Toaster } from '@accelerate/ui/components/ui/sonner'
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
