import { Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './hooks/useTheme'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Watchlist from './pages/Watchlist'
import Recordings from './pages/Recordings'
import Watch from './pages/Watch'
import WatchPlayer from './pages/WatchPlayer'
import Settings from './pages/Settings'
import { Toaster } from 'react-hot-toast'
import { TimezoneProvider } from './lib/timezone-context'

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
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <TimezoneProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="watchlist" element={<Watchlist />} />
          <Route path="recordings" element={<Recordings />} />
          <Route path="watch" element={<Watch />} />
          <Route path="watch/:id" element={<WatchPlayer />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
      </TimezoneProvider>
      <ToasterWrapper />
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
