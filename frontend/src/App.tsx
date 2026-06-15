import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { ThemeProvider } from './hooks/useTheme'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import { Toaster } from 'react-hot-toast'
import { TimezoneProvider } from './lib/timezone-context'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Watchlist = lazy(() => import('./pages/Watchlist'))
const Recordings = lazy(() => import('./pages/Recordings'))
const Watch = lazy(() => import('./pages/Watch'))
const WatchPlayer = lazy(() => import('./pages/WatchPlayer'))
const Clips = lazy(() => import('./pages/Clips'))
const ClipPlayer = lazy(() => import('./pages/ClipPlayer'))
const Settings = lazy(() => import('./pages/Settings'))

function ToasterWrapper() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'var(--color-popover)',
          color: 'var(--color-popover-foreground)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-lg)',
          borderRadius: '0.75rem',
          padding: '0.75rem 1rem',
          fontSize: '0.875rem',
        },
        success: {
          iconTheme: {
            primary: 'var(--color-success)',
            secondary: 'var(--color-popover)',
          },
        },
        error: {
          iconTheme: {
            primary: 'var(--color-danger)',
            secondary: 'var(--color-popover)',
          },
        },
      }}
    />
  )
}

function App() {
  const location = useLocation()

  useEffect(() => {
    window.HSStaticMethods?.autoInit()
  }, [location.pathname])

  return (
    <ErrorBoundary>
    <ThemeProvider>
      <TimezoneProvider>
      <Suspense fallback={<div className="flex h-screen items-center justify-center"><span className="text-muted">Loading...</span></div>}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="watchlist" element={<Watchlist />} />
            <Route path="recordings" element={<Recordings />} />
            <Route path="watch" element={<Watch />} />
            <Route path="watch/:id" element={<WatchPlayer />} />
            <Route path="clips" element={<Clips />} />
            <Route path="clips/:id" element={<ClipPlayer />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Suspense>
      </TimezoneProvider>
      <ToasterWrapper />
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
