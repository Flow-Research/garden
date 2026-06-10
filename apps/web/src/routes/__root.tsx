import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { Suspense, lazy } from 'react'
import { WebProviders } from '@/components/web-providers'
import appCss from '../styles.css?url'
import '../bones/registry'

const Devtools =
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEVTOOLS === '1'
    ? lazy(async () => {
        const [{ TanStackDevtools }, { TanStackRouterDevtoolsPanel }] =
          await Promise.all([
            import('@tanstack/react-devtools'),
            import('@tanstack/react-router-devtools'),
          ])
        return {
          default: function DevtoolsPanel() {
            return (
              <TanStackDevtools
                config={{ position: 'bottom-right' }}
                plugins={[
                  {
                    name: 'TanStack Router',
                    render: <TanStackRouterDevtoolsPanel />,
                  },
                ]}
              />
            )
          },
        }
      })
    : null

const APP_TITLE = 'Garden'
const APP_DESCRIPTION =
  'Garden is a company operating surface where humans and AI agents work side by side.'
const APP_THEME_COLOR = '#f4f1e8'
const APP_COVER_IMAGE = '/garden-cover.png'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='system')?stored:'system';var storedColorTheme=window.localStorage.getItem('color-theme');var colorTheme=storedColorTheme==='garden'?'garden':'garden';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='system'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.style.colorScheme=resolved;root.dataset.theme=colorTheme;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: APP_TITLE },
      { name: 'description', content: APP_DESCRIPTION },
      { name: 'application-name', content: APP_TITLE },
      { name: 'apple-mobile-web-app-title', content: APP_TITLE },
      { name: 'theme-color', content: APP_THEME_COLOR },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: APP_TITLE },
      { property: 'og:title', content: APP_TITLE },
      { property: 'og:description', content: APP_DESCRIPTION },
      { property: 'og:image', content: APP_COVER_IMAGE },
      { property: 'og:image:width', content: '1536' },
      { property: 'og:image:height', content: '1024' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: APP_TITLE },
      { name: 'twitter:description', content: APP_DESCRIPTION },
      { name: 'twitter:image', content: APP_COVER_IMAGE },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      {
        rel: 'icon',
        href: '/favicon-32x32.png',
        type: 'image/png',
        sizes: '32x32',
      },
      {
        rel: 'icon',
        href: '/favicon-16x16.png',
        type: 'image/png',
        sizes: '16x16',
      },
      {
        rel: 'apple-touch-icon',
        href: '/apple-touch-icon.png',
        sizes: '180x180',
      },
      { rel: 'manifest', href: '/manifest.json' },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="h-full overflow-hidden antialiased">
        <NuqsAdapter>
          <WebProviders>
            <Outlet />
          </WebProviders>
        </NuqsAdapter>
        {Devtools ? (
          <Suspense fallback={null}>
            <Devtools />
          </Suspense>
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
