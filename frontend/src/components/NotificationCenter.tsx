import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  BellRing,
  Check,
  Radio,
  Video,
  Scissors,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, type AppNotification } from '@/lib/api'

function iconFor(type: string) {
  if (type === 'user_live') return { Icon: Radio, cls: 'text-red-500' }
  if (type === 'recording_completed') return { Icon: CheckCircle2, cls: 'text-success' }
  if (type === 'recording_failed') return { Icon: AlertCircle, cls: 'text-danger' }
  if (type === 'recording_stopped') return { Icon: Video, cls: 'text-muted-foreground' }
  if (type === 'clip_ready') return { Icon: Scissors, cls: 'text-primary' }
  return { Icon: Bell, cls: 'text-muted-foreground' }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - then)
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationCenter({
  size = 'sm',
  placement = 'bottom',
}: {
  size?: 'sm' | 'md'
  placement?: 'bottom' | 'top'
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  )
  const containerRef = useRef<HTMLDivElement>(null)

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications.list(50),
    refetchInterval: 60000,
  })

  const notifications = data?.notifications ?? []
  const unread = data?.unread ?? 0

  // -- Live SSE subscription -------------------------------------------------
  useEffect(() => {
    const es = new EventSource(api.notifications.streamUrl())

    es.onmessage = (e) => {
      let notif: AppNotification | null = null
      try {
        notif = JSON.parse(e.data)
      } catch {
        return
      }
      if (!notif || !notif.id) return

      // Merge into the cached list + bump unread.
      queryClient.setQueryData(
        ['notifications'],
        (old: { notifications: AppNotification[]; unread: number } | undefined) => {
          const list = old?.notifications ?? []
          if (list.some((n) => n.id === notif!.id)) return old
          return {
            notifications: [notif!, ...list].slice(0, 50),
            unread: (old?.unread ?? 0) + 1,
          }
        }
      )

      // Desktop notification when permitted.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(notif.title, { body: notif.message, tag: `tikrec-${notif.id}` })
        } catch {
          /* ignore */
        }
      }
    }

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    }

    return () => es.close()
  }, [queryClient])

  // -- Close on outside click ------------------------------------------------
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markAllRead = useCallback(async () => {
    await api.notifications.markAllRead()
    queryClient.setQueryData(
      ['notifications'],
      (old: { notifications: AppNotification[]; unread: number } | undefined) =>
        old ? { notifications: old.notifications.map((n) => ({ ...n, read: true })), unread: 0 } : old
    )
  }, [queryClient])

  const enableDesktop = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
  }, [])

  const handleClick = useCallback(
    (n: AppNotification) => {
      setOpen(false)
      const d = n.data || {}
      if (d.clip_id) navigate(`/clips/${d.clip_id}`)
      else if (n.type === 'user_live') navigate('/live')
      else if (d.recording_id && n.type === 'recording_completed') navigate(`/watch/${d.recording_id}`)
      else if (d.recording_id) navigate('/recordings')
    },
    [navigate]
  )

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      // Mark read shortly after opening so the badge clears.
      markAllRead()
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        className={cn(
          'relative flex items-center justify-center rounded-lg transition-colors',
          'text-muted-foreground hover:bg-muted/60',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-primary',
          open && 'bg-muted/60 text-foreground',
          size === 'md' ? 'h-12 w-12' : 'h-9 w-9'
        )}
      >
        {unread > 0 ? <BellRing className={cn('shrink-0', size === 'md' ? 'h-5 w-5' : 'h-[18px] w-[18px]')} /> : <Bell className={cn('shrink-0', size === 'md' ? 'h-5 w-5' : 'h-[18px] w-[18px]')} />}
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold ring-2 ring-background">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={cn(
          'absolute right-0 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover text-popover-foreground shadow-lg z-50 overflow-hidden',
          placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
        )}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <p className="text-sm font-semibold">Notifications</p>
            {notifications.length > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <Check className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {permission === 'default' && (
            <button
              onClick={enableDesktop}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-primary hover:bg-accent border-b border-border transition-colors"
            >
              <BellRing className="h-3.5 w-3.5" />
              Enable desktop notifications
            </button>
          )}

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => {
                const { Icon, cls } = iconFor(n.type)
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-accent transition-colors border-b border-border/50 last:border-0',
                      !n.read && 'bg-primary-subtle/40'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', cls)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                      {n.message && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{n.message}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground/70 mt-0.5">{timeAgo(n.created_at)}</p>
                    </div>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
