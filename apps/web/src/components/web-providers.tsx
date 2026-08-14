import { CoreProvider } from '@garden/app-state/platform/core-provider'
import { ThemeProvider } from '@garden/ui/components/common/theme-provider'
import { Toaster } from '@garden/ui/components/ui/sonner'
import { WebNavigationProvider } from '@/platform/navigation'
import { api, configureApi } from '@/lib/api'
import { resetPostHogIdentity } from '@/lib/posthog-browser'
import { AppUpdateNotice } from '@/components/app-update-notice'

function redirectToLogin() {
  if (typeof window !== 'undefined') {
    resetPostHogIdentity()
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
      <AppUpdateNotice />
      <Toaster />
    </ThemeProvider>
  )
}
