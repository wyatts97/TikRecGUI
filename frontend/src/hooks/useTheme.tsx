import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'neo-futurism'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = getStoredTheme()
    return stored ?? getSystemTheme()
  })

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

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
