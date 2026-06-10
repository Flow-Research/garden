import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
} from 'next-themes'
import { TooltipProvider } from '../ui/tooltip'

export const colorThemeValues = ['garden'] as const
export type ColorTheme = (typeof colorThemeValues)[number]

type ColorThemeContextValue = {
  colorTheme: ColorTheme
  setColorTheme: (value: ColorTheme) => void
}

const COLOR_THEME_STORAGE_KEY = 'color-theme'

const ColorThemeContext = createContext<ColorThemeContextValue | null>(null)

function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [colorTheme, setColorThemeState] = useState<ColorTheme>('garden')

  useEffect(() => {
    if (typeof window === 'undefined') return

    const stored = window.localStorage.getItem(COLOR_THEME_STORAGE_KEY)
    if (stored === 'garden') {
      setColorThemeState('garden')
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, colorTheme)
  }, [colorTheme])

  const value = useMemo<ColorThemeContextValue>(
    () => ({
      colorTheme,
      setColorTheme: setColorThemeState,
    }),
    [colorTheme],
  )

  return <ColorThemeContext.Provider value={value}>{children}</ColorThemeContext.Provider>
}

export function useTheme() {
  const nextTheme = useNextTheme()
  const colorTheme = useContext(ColorThemeContext)

  if (!colorTheme) {
    throw new Error('useTheme must be used within ThemeProvider')
  }

  return {
    ...nextTheme,
    colorTheme: colorTheme.colorTheme,
    setColorTheme: colorTheme.setColorTheme,
  }
}

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <ColorThemeProvider>
        <TooltipProvider delay={500}>{children}</TooltipProvider>
      </ColorThemeProvider>
    </NextThemesProvider>
  )
}
