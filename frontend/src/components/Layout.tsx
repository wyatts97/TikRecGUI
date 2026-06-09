import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Video,
  Settings,
  Radio,
  Moon,
  Sun,
  Tv,
  RefreshCw,
  Circle,
  Menu,
  X,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/lib/api'
import CommandPalette from '@/components/CommandPalette'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/watchlist', icon: Users, label: 'Watchlist' },
  { to: '/recordings', icon: Video, label: 'Recordings' },
  { to: '/watch', icon: Tv, label: 'Watch' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Checking…'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const queryClient = useQueryClient()
  const [countdown, setCountdown] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const { data: monitorStatus } = useQuery({
    queryKey: ['monitorStatus'],
    queryFn: () => api.settings.getMonitorStatus(),
    refetchInterval: 10000,
  })

  const { data: activeRecordings = [] } = useQuery({
    queryKey: ['activeRecordings'],
    queryFn: () => api.recordings.getActive(),
    refetchInterval: 5000,
  })

  const triggerCheckMutation = useMutation({
    mutationFn: () => api.settings.triggerMonitorCheck(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitorStatus'] })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setCountdown(0)
    },
  })

  useEffect(() => {
    if (monitorStatus?.next_check_in_seconds !== undefined && monitorStatus.next_check_in_seconds !== null) {
      setCountdown(monitorStatus.next_check_in_seconds)
    }
  }, [monitorStatus])

  useEffect(() => {
    if (countdown === null || countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((c: number | null) => (c !== null ? Math.max(0, c - 1) : null))
    }, 1000)
    return () => clearInterval(timer)
  }, [countdown])

  // Close sidebar on route navigate (mobile)
  const handleNav = (to: string) => {
    navigate(to)
    setSidebarOpen(false)
  }

  return (
    <div className="min-h-screen bg-background">
      <CommandPalette />

      {/* Mobile header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-background border-b border-border md:hidden">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold text-foreground tracking-tight">TikRec</span>
          </div>
          <div className="flex items-center gap-1">
            {activeRecordings.length > 0 && (
              <button
                onClick={() => navigate('/recordings')}
                className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-medium animate-pulse mr-1"
              >
                <Circle className="h-1.5 w-1.5 fill-current" />
                {activeRecordings.length}
              </button>
            )}
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center h-9 w-9 rounded-lg text-muted-foreground hover:bg-muted/60 transition-colors"
              aria-label="Toggle dark mode"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex items-center justify-center h-9 w-9 rounded-lg text-muted-foreground hover:bg-muted/60 transition-colors"
              aria-label="Toggle menu"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className={cn(
          'fixed top-14 left-0 bottom-0 z-30 w-64 bg-background border-r border-border transform transition-transform duration-200 md:hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <nav className="flex flex-col p-3 gap-1">
          {navItems.map((item) => (
            <button
              key={item.to}
              onClick={() => handleNav(item.to)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left',
                location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to))
                  ? 'bg-primary-subtle text-primary'
                  : 'text-muted-foreground hover:bg-muted/60',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:w-56 z-30 bg-background border-r border-border">
        <div className="flex items-center gap-2 h-16 px-5 border-b border-border">
          <Radio className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold text-foreground tracking-tight">TikRec</span>
        </div>

        <nav className="flex flex-col flex-1 p-3 gap-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-subtle text-primary'
                      : 'text-muted-foreground hover:bg-muted/60',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        {/* Sidebar footer */}
        <div className="p-3 border-t border-border space-y-2">
          {activeRecordings.length > 0 && (
            <button
              onClick={() => navigate('/recordings')}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs font-medium animate-pulse"
            >
              <Circle className="h-2 w-2 fill-current" />
              {activeRecordings.length} recording{activeRecordings.length > 1 ? 's' : ''} in progress
            </button>
          )}

          {monitorStatus?.is_running && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-xs text-muted-foreground">
              <span className="tabular-nums">
                {countdown !== null
                  ? `Next check: ${formatCountdown(countdown)}`
                  : 'Waiting…'}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={() => triggerCheckMutation.mutate()}
              disabled={triggerCheckMutation.isPending}
              className="flex items-center justify-center h-8 w-8 rounded-lg transition-colors text-muted-foreground hover:bg-muted/60 disabled:opacity-50"
              aria-label="Check live status now"
              title="Check live status now"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', triggerCheckMutation.isPending && 'animate-spin')} />
            </button>
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center h-8 w-8 rounded-lg transition-colors text-muted-foreground hover:bg-muted/60"
              aria-label="Toggle dark mode"
              title="Toggle dark mode"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="md:pl-56 pt-14 md:pt-0 pb-8">
        <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
