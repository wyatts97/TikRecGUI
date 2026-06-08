import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, Video, Settings, Radio, Moon, Sun, Tv, RefreshCw } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/lib/api'

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
  const { theme, toggleTheme } = useTheme()
  const queryClient = useQueryClient()
  const [countdown, setCountdown] = useState<number | null>(null)

  const { data: monitorStatus } = useQuery({
    queryKey: ['monitorStatus'],
    queryFn: () => api.settings.getMonitorStatus(),
    refetchInterval: 10000,
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

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-kraken-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <Radio className="h-6 w-6 text-primary" />
              <span className="text-xl font-bold text-kraken-black tracking-tight">
                TikRec
              </span>
            </div>

            <div className="flex items-center gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary-subtle text-primary'
                        : 'text-kraken-gray hover:bg-gray-100'
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </NavLink>
              ))}

              {monitorStatus?.is_running && (
                <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-xs text-kraken-gray">
                  <span className="tabular-nums">
                    {countdown !== null
                      ? `Next check: ${formatCountdown(countdown)}`
                      : 'Waiting…'}
                  </span>
                </div>
              )}

              <button
                onClick={() => triggerCheckMutation.mutate()}
                disabled={triggerCheckMutation.isPending}
                className="flex items-center justify-center h-9 w-9 rounded-lg transition-colors text-kraken-gray hover:bg-gray-100 disabled:opacity-50"
                aria-label="Check live status now"
                title="Check live status now"
              >
                <RefreshCw className={cn('h-4 w-4', triggerCheckMutation.isPending && 'animate-spin')} />
              </button>

              <button
                onClick={toggleTheme}
                className="flex items-center justify-center h-9 w-9 rounded-lg transition-colors text-kraken-gray hover:bg-gray-100"
                aria-label="Toggle dark mode"
                title="Toggle dark mode"
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="pt-20 pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
