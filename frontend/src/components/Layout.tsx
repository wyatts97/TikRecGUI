import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
// Nav icons now come from lib/nav.ts; these are the chrome-only ones.
import { Radio, Circle, Menu, X, PanelLeft } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { PageTransition } from '@/components/motion'
import CommandPalette from '@/components/CommandPalette'
import NotificationCenter from '@/components/NotificationCenter'
import MonitorCountdown from '@/components/MonitorCountdown'
import { useNotificationStream } from '@/hooks/useNotificationStream'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/selia/tooltip'
import { NAV_ITEMS as navItems } from '@/lib/nav'


export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [miniMode, setMiniMode] = useState(false)

  // Mounted here (once) rather than inside NotificationCenter, which renders
  // twice -- see the hook's comment.
  useNotificationStream()

  // Escape closes the mobile drawer, matching what a dialog would do.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

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
    },
  })


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
            <div className="h-6 w-6 rounded-full bg-red-500 shadow-lg shadow-red-500/40" />
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
            <NotificationCenter />
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex items-center justify-center h-9 w-9 rounded-lg text-muted-foreground hover:bg-muted/60 transition-colors"
              aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={sidebarOpen}
              aria-controls="mobile-nav"
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
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        id="mobile-nav"
        // Translated off-screen when closed, which left its links in the tab
        // order. inert takes the whole subtree out of the focus and a11y trees.
        // Spread with a cast because React 18's types don't know `inert` yet
        // (it is typed from React 19); the attribute itself is passed through.
        {...({ inert: sidebarOpen ? undefined : '' } as { inert?: string })}
        aria-hidden={!sidebarOpen}
        className={cn(
          'fixed top-14 left-0 bottom-0 z-30 w-64 bg-background border-r border-border transform transition-transform duration-200 md:hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <nav className="flex flex-col p-3 gap-1" aria-label="Main">
          {navItems.map((item) => (
            <button
              key={item.to}
              onClick={() => handleNav(item.to)}
              className={cn(
                'flex items-center gap-3.5 px-3.5 py-3 rounded-lg text-base font-medium transition-colors text-left',
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

      {/* Desktop sidebar - Preline content push mini */}
      <aside
        className={cn(
          'hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-30 md:bg-background md:border-r md:border-border md:flex-col md:transition-all md:duration-300',
          miniMode ? 'md:w-20' : 'md:w-64'
        )}
      >
        {/* Header */}
        <div className={cn(
          'flex items-center h-16 border-b border-border shrink-0',
          miniMode ? 'justify-between px-2' : 'px-5 gap-2.5'
        )}>
          <div className="h-8 w-8 rounded-full bg-red-500 shadow-lg shadow-red-500/40 shrink-0" />
          {!miniMode && (
            <span className="text-xl font-bold text-foreground tracking-tight flex-1">TikRec</span>
          )}
          <button
            onClick={() => setMiniMode(!miniMode)}
            className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted/60 transition-colors shrink-0"
            aria-label={miniMode ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <PanelLeft className={cn('h-4 w-4', miniMode && 'rotate-180')} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto pt-2">
          <ul className={cn('flex flex-col gap-1', miniMode ? 'p-2' : 'p-3')}>
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to + '/'))
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={cn(
                      'flex items-center rounded-lg transition-colors',
                      miniMode ? 'justify-center px-2 py-2.5' : 'gap-3.5 px-3.5 py-3',
                      isActive
                        ? 'bg-primary-subtle text-primary'
                        : 'text-muted-foreground hover:bg-muted/60',
                    )}
                    title={miniMode ? item.label : undefined}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {!miniMode && (
                      <span className="text-base font-medium">{item.label}</span>
                    )}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className={cn(
          'border-t border-border shrink-0',
          miniMode ? 'p-2' : 'p-4'
        )}>
          <div className={cn(
            'flex',
            miniMode ? 'flex-col items-center gap-3' : 'flex-row items-center justify-center gap-3'
          )}>
            {/* Circular Progress */}
            <Tooltip>
              <TooltipTrigger>
                <button
                  type="button"
                  onClick={() => !triggerCheckMutation.isPending && triggerCheckMutation.mutate()}
                  aria-label={triggerCheckMutation.isPending ? 'Syncing' : 'Sync now'}
                  className="cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-primary"
                >
                  <MonitorCountdown
                    nextCheckInSeconds={monitorStatus?.next_check_in_seconds}
                    intervalSeconds={
                      monitorStatus?.check_interval ??
                      (monitorStatus?.interval_minutes ? monitorStatus.interval_minutes * 60 : 60)
                    }
                    miniMode={miniMode}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {triggerCheckMutation.isPending ? 'Syncing…' : 'Sync Now'}
              </TooltipContent>
            </Tooltip>

            {/* Recording indicator */}
            <Tooltip>
              <TooltipTrigger>
                <button
                  type="button"
                  onClick={() => activeRecordings.length > 0 && navigate('/recordings')}
                  aria-label={activeRecordings.length > 0 ? `${activeRecordings.length} recording(s) in progress` : 'No active recordings'}
                  className={cn(
                    'relative flex items-center justify-center w-12 h-12 rounded-full transition-colors cursor-pointer',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-primary',
                    activeRecordings.length > 0
                      ? 'bg-red-500 text-white shadow-lg shadow-red-500/40 animate-pulse'
                      : 'bg-muted/60 text-muted-foreground'
                  )}
                >
                  <Radio className="h-5 w-5" />
                  {activeRecordings.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-5 flex items-center justify-center px-1 rounded-full bg-white text-black text-[10px] font-semibold shadow-md">
                      {activeRecordings.length}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {activeRecordings.length > 0 ? `${activeRecordings.length} recording(s) in progress` : 'No active recordings'}
              </TooltipContent>
            </Tooltip>

            {/* Notification bell */}
            <NotificationCenter size="md" placement="top" align="left" />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className={cn(
        'transition-all duration-300',
        miniMode ? 'md:pl-20' : 'md:pl-64',
        'pt-14 md:pt-0 pb-8'
      )}>
        <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
          <AnimatePresence mode="wait" initial={false}>
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
