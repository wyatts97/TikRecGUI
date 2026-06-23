import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'neo-futurism'

export interface AccentPreset {
  key: string
  label: string
  /** Swatch color for the picker UI. */
  swatch: string
  /** Override applied to the `--primary` token, or null to use the theme default. */
  primary: string | null
  /** Override applied to the `--primary-border` token. */
  border: string | null
}

/** Built-in accent presets. `default` clears any override (theme blue). */
export const ACCENT_PRESETS: AccentPreset[] = [
  { key: 'default', label: 'Default', swatch: 'oklch(0.5784 0.2057 262.95)', primary: null, border: null },
  { key: 'violet', label: 'Violet', swatch: 'oklch(0.561 0.2456 302.32)', primary: 'oklch(0.561 0.2456 302.32)', border: 'oklch(0.512 0.233 302.4)' },
  { key: 'pink', label: 'Pink', swatch: 'oklch(0.6559 0.2118 354.31)', primary: 'oklch(0.6559 0.2118 354.31)', border: 'oklch(0.592 0.205 354.4)' },
  { key: 'rose', label: 'Rose', swatch: 'oklch(0.6368 0.2078 25.33)', primary: 'oklch(0.6368 0.2078 25.33)', border: 'oklch(0.575 0.198 25.4)' },
  { key: 'orange', label: 'Orange', swatch: 'oklch(0.7049 0.1867 47.6)', primary: 'oklch(0.7049 0.1867 47.6)', border: 'oklch(0.646 0.18 47.7)' },
  { key: 'emerald', label: 'Emerald', swatch: 'oklch(0.6959 0.1491 162.48)', primary: 'oklch(0.6959 0.1491 162.48)', border: 'oklch(0.627 0.142 162.5)' },
  { key: 'teal', label: 'Teal', swatch: 'oklch(0.7045 0.1234 182.5)', primary: 'oklch(0.7045 0.1234 182.5)', border: 'oklch(0.637 0.118 182.6)' },
]

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  accent: string
  setAccent: (accent: string) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  accent: 'default',
  setAccent: () => {},
})

function getSystemTheme(): Theme {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem('tikrec-theme')
  if (stored === 'light' || stored === 'dark' || stored === 'neo-futurism') return stored
  return null
}

function getStoredAccent(): string {
  return localStorage.getItem('tikrec-accent') || 'default'
}

function applyAccent(accent: string) {
  const root = window.document.documentElement
  const preset = ACCENT_PRESETS.find((p) => p.key === accent)
  // Custom accent stored as a raw color string when not a known preset.
  const isCustom = !preset && accent !== 'default'
  const primary = preset?.primary ?? (isCustom ? accent : null)
  const border = preset?.border ?? (isCustom ? accent : null)
  if (primary) {
    root.style.setProperty('--primary', primary)
    root.style.setProperty('--primary-border', border ?? primary)
  } else {
    root.style.removeProperty('--primary')
    root.style.removeProperty('--primary-border')
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = getStoredTheme()
    return stored ?? getSystemTheme()
  })
  const [accent, setAccentState] = useState<string>(() => getStoredAccent())

  useEffect(() => {
    applyAccent(accent)
  }, [accent])

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.removeAttribute('data-theme')

    if (theme === 'light') {
      root.classList.add('light')
    } else if (theme === 'dark') {
      root.classList.add('dark')
    } else if (theme === 'neo-futurism') {
      root.classList.add('dark')
      root.setAttribute('data-theme', 'theme-neo-futurism')
    }
  }, [theme])

  useEffect(() => {
    const listener = (e: MediaQueryListEvent) => {
      if (!getStoredTheme()) {
        setThemeState(e.matches ? 'dark' : 'light')
      }
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])

  const setTheme = (newTheme: Theme) => {
    localStorage.setItem('tikrec-theme', newTheme)
    setThemeState(newTheme)
  }

  const setAccent = (newAccent: string) => {
    localStorage.setItem('tikrec-accent', newAccent)
    setAccentState(newAccent)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
