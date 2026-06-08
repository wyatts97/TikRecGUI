import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
})

function getSystemTheme(): Theme {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem('tikrec-theme')
  if (stored === 'dark' || stored === 'light') return stored
  return null
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = getStoredTheme()
    return stored ?? getSystemTheme()
  })

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme)
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

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
