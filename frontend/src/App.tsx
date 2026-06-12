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
import { Toaster } from 'sonner'
import { TimezoneProvider } from './lib/timezone-context'
import { useTheme } from './hooks/useTheme'

function ToasterWrapper() {
  const { theme } = useTheme()
  return (
    <>
      <style>{`
        [data-sonner-toast] {
          width: auto !important;
          min-width: 0 !important;
          max-width: none !important;
        }
        [data-sonner-toast] [data-close-button] {
          top: 6px !important;
          right: 6px !important;
          transform: none !important;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          color: inherit !important;
          opacity: 0.5;
        }
        [data-sonner-toast] [data-close-button]:hover {
          opacity: 1;
        }
      `}</style>
      <Toaster
        theme={theme}
        closeButton
        toastOptions={{
          className:
            'bg-popover text-popover-foreground border border-border shadow-lg w-fit min-w-0 !max-w-none',
        }}
      />
    </>
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
