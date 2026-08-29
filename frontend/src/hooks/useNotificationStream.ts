import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type AppNotification } from '@/lib/api'

type NotificationCache = { notifications: AppNotification[]; unread: number }

/**
 * Subscribes to the notification SSE stream.
 *
 * This lives in a hook rather than in NotificationCenter because that component
 * is rendered twice (mobile header + desktop sidebar) and both copies stay in
 * the DOM -- visibility is CSS-only. Owning the EventSource there opened two
 * connections and fired every desktop notification twice. Mount this exactly
 * once, from Layout.
 */
export function useNotificationStream() {
  const queryClient = useQueryClient()

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
      const incoming = notif

      queryClient.setQueryData(
        ['notifications'],
        (old: NotificationCache | undefined) => {
          const list = old?.notifications ?? []
          if (list.some((n) => n.id === incoming.id)) return old
          return {
            notifications: [incoming, ...list].slice(0, 50),
            unread: (old?.unread ?? 0) + 1,
          }
        }
      )

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(incoming.title, {
            body: incoming.message,
            tag: `tikrec-${incoming.id}`,
          })
        } catch {
          /* ignore */
        }
      }
    }

    es.onerror = () => {
      // EventSource reconnects on its own.
    }

    return () => es.close()
  }, [queryClient])
}
