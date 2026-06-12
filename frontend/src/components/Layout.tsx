import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Video,
  Settings,
  Radio,
  Tv,
  Circle,
  Menu,
  X,
  Sun,
  Moon,
} from 'lucide-react'
import { DarkModeSwitch } from 'react-toggle-dark-mode'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/lib/api'
import CommandPalette from '@/components/CommandPalette'
import { IconBox } from '@/components/selia/icon-box'
import { Badge } from '@/components/selia/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/selia/tooltip'
import { Progress } from '@/components/selia/progress'
import {
  Sidebar,
  SidebarHeader,
  SidebarLogo,
  SidebarContent,
  SidebarMenu,
  SidebarList,
  SidebarItem,
  SidebarItemButton,
  SidebarFooter,
} from '@/components/selia/sidebar'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/watchlist', icon: Users, label: 'Watchlist' },
  { to: '/recordings', icon: Video, label: 'Recordings' },
  { to: '/watch', icon: Tv, label: 'Watch' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

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
            <DarkModeSwitch
              checked={theme === 'dark'}
              onChange={() => toggleTheme()}
              size={20}
              className="flex items-center justify-center h-9 w-9 rounded-lg text-muted-foreground hover:bg-muted/60 transition-colors"
              aria-label="Toggle dark mode"
            />
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
                location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to + '/'))
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
      <Sidebar className="hidden md:flex md:fixed md:inset-y-0 md:w-56 z-30 bg-background border-r border-border">
        <SidebarHeader>
          <SidebarLogo className="h-16 border-b border-border px-5">
            <img src="/tikrecui.png" alt="TikRec" className="h-8 w-8 rounded-lg" />
            <span className="text-xl font-bold text-foreground tracking-tight">TikRec</span>
          </SidebarLogo>
        </SidebarHeader>

        <SidebarContent>
          <SidebarMenu>
            <SidebarList>
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to + '/'))
                return (
                  <SidebarItem key={item.to}>
                    <SidebarItemButton
                      render={<NavLink to={item.to} end={item.to === '/'} />}
                      active={isActive}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </SidebarItemButton>
                  </SidebarItem>
                )
              })}
            </SidebarList>
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter>
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            {/* Refresh progress bar */}
            <Tooltip>
              <TooltipTrigger>
                <div
                  onClick={() => !triggerCheckMutation.isPending && triggerCheckMutation.mutate()}
                  className="cursor-pointer"
                >
                  {(() => {
                    const interval = monitorStatus?.check_interval ?? (monitorStatus?.interval_minutes ? monitorStatus.interval_minutes * 60 : 60)
                    const isReady = countdown === null || countdown <= 0
                    const value = isReady ? interval : Math.max(0, interval - countdown)
                    return (
                      <Progress
                        label="Time to refresh"
                        count={isReady ? 'Ready' : `${countdown}s`}
                        value={value}
                        max={interval}
                        variant={isReady ? 'success' : 'warning'}
                      />
                    )
                  })()}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {triggerCheckMutation.isPending ? 'Syncing…' : 'Sync Now'}
              </TooltipContent>
            </Tooltip>

            {/* Icon row */}
            <div className="flex items-center gap-2">
              {/* Recording indicator */}
              <Tooltip>
                <TooltipTrigger>
                  <div
                    onClick={() => activeRecordings.length > 0 && navigate('/recordings')}
                    className={cn(
                      'relative flex items-center justify-center rounded-xl p-2 transition-colors cursor-pointer',
                      activeRecordings.length > 0 && 'hover:bg-muted/60'
                    )}
                  >
                    {activeRecordings.length > 0 ? (
                      <>
                        <IconBox
                          variant="danger"
                          size="md"
                          className="shadow-lg shadow-red-500/40 animate-pulse"
                        >
                          <Radio className="h-4 w-4" />
                        </IconBox>
                        <Badge
                          variant="danger"
                          size="sm"
                          className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 flex items-center justify-center px-1 text-[10px]"
                        >
                          {activeRecordings.length}
                        </Badge>
                      </>
                    ) : (
                      <IconBox variant="secondary-subtle" size="md">
                        <Radio className="h-4 w-4" />
                      </IconBox>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {activeRecordings.length > 0 ? `${activeRecordings.length} recording(s) in progress` : 'No active recordings'}
                </TooltipContent>
              </Tooltip>

              {/* Dark mode toggle */}
              <Tooltip>
                <TooltipTrigger>
                  <div
                    onClick={() => toggleTheme()}
                    className="flex items-center justify-center rounded-xl p-2 hover:bg-muted/60 transition-colors cursor-pointer"
                  >
                    <IconBox variant="secondary-subtle" size="md">
                      {theme === 'dark' ? (
                        <Sun className="h-4 w-4" />
                      ) : (
                        <Moon className="h-4 w-4" />
                      )}
                    </IconBox>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* Main content */}
      <main className="md:pl-56 pt-14 md:pt-0 pb-8">
        <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
