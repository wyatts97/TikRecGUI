import { Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './hooks/useTheme'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Watchlist from './pages/Watchlist'
import Recordings from './pages/Recordings'
import Settings from './pages/Settings'
import { Toaster } from './components/ui/toaster'

function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="watchlist" element={<Watchlist />} />
          <Route path="recordings" element={<Recordings />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
      <Toaster />
    </ThemeProvider>
  )
}

export default App
