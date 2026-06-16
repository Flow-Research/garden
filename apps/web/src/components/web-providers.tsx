import { CoreProvider } from '@garden/app-state/platform/core-provider'
import { ThemeProvider } from '@garden/ui/components/common/theme-provider'
import { Toaster } from '@garden/ui/components/ui/sonner'
import { WebNavigationProvider } from '@/platform/navigation'
import { api, configureApi } from '@/lib/api'

function redirectToLogin() {
  if (typeof window !== 'undefined') {
    window.location.replace('/login')
  }
}

export function WebProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CoreProvider
        api={api}
        configureApi={configureApi}
        apiBaseUrl=""
        onLogout={redirectToLogin}
      >
        <WebNavigationProvider>{children}</WebNavigationProvider>
      </CoreProvider>
      <Toaster />
    </ThemeProvider>
  )
}
