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
import { Toaster } from './components/ui/toaster'
import { TimezoneProvider } from './lib/timezone-context'

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
      <Toaster />
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
