import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ComponentProps, ReactNode } from 'react'
import { TooltipProvider } from '../ui/tooltip'

/**
 * App theme provider: next-themes class strategy (light/dark/system) plus the
 * shared tooltip context.
 *
 * The previous colorTheme dimension (a single 'garden' value stored under a
 * `color-theme` localStorage key and applied as `data-theme`) was removed when
 * the design-token system landed: generated tokens.css scopes semantics on
 * plain `:root` / `:root.dark`, so the extra attribute was inert. If multiple
 * color themes ever return, they should be modeled as token-set variants in
 * tokens.json, not a runtime attribute.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider> & { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <TooltipProvider delay={500}>{children}</TooltipProvider>
    </NextThemesProvider>
  )
}
