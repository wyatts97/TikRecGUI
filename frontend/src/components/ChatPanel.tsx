import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle, Gift, Search, Loader2 } from 'lucide-react'
import { Input } from 'components/selia/input'
import { api } from '@/lib/api'
import type { Recording, LiveEvent } from '@/lib/api'

function formatOffset(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

interface ChatPanelProps {
  recording: Recording
  chatSearch: string
  onChatSearchChange: (value: string) => void
  onSeek?: (seconds: number) => void
  /** Render as a standalone panel (desktop) vs inline (mobile) */
  variant?: 'panel' | 'inline'
}

export default function ChatPanel({
  recording,
  chatSearch,
  onChatSearchChange,
  onSeek,
  variant = 'inline',
}: ChatPanelProps) {
  const [tabFilter, setTabFilter] = useState<'all' | 'chat' | 'gifts'>('all')

  const { data: eventsData, isLoading } = useQuery({
    queryKey: ['live-events', recording.id, tabFilter],
    queryFn: () => api.recordings.getEvents(
      recording.id,
      1,
      500,
      tabFilter === 'all' ? undefined : tabFilter,
    ),
    refetchInterval: recording.status === 'recording' ? 3000 : false,
  })

  const events = eventsData?.events ?? []

  const filteredEvents = chatSearch
    ? events.filter((ev: LiveEvent) => {
        const q = chatSearch.toLowerCase()
        if (ev.user_nickname.toLowerCase().includes(q)) return true
        if (ev.content?.toLowerCase().includes(q)) return true
        if (ev.gift_name?.toLowerCase().includes(q)) return true
        return false
      })
    : events

  const content = (
    <>
      {/* Tab filter */}
      <div className="flex gap-1 border-b border-border pb-2">
        {(['all', 'chat', 'gifts'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setTabFilter(tab)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              tabFilter === tab
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {tab === 'all' ? 'All' : tab === 'chat' ? 'Chat' : 'Gifts'}
          </button>
        ))}
      </div>

      {/* Search */}
      {events.length > 0 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search chat & gifts…"
            value={chatSearch}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChatSearchChange(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center gap-2 py-6 justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading events…</p>
        </div>
      )}

      {/* Empty states */}
      {!isLoading && events.length === 0 && recording.status === 'recording' && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Waiting for chat events…</p>
        </div>
      )}

      {!isLoading && events.length === 0 && recording.status !== 'recording' && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <MessageCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No chat or gift events captured</p>
        </div>
      )}

      {/* Events list */}
      {filteredEvents.length > 0 && (
        <div className="font-mono text-xs space-y-1">
          {filteredEvents.map((ev: LiveEvent) => (
            <p key={ev.id} className={`leading-relaxed ${ev.event_type === 'gift' ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              <button
                onClick={() => onSeek?.(ev.offset_seconds)}
                className="text-primary hover:underline cursor-pointer"
                title={`Jump to ${formatOffset(ev.offset_seconds)}`}
              >
                [{formatOffset(ev.offset_seconds)}]
              </button>
              {' '}
              <span className="font-semibold text-foreground">{ev.user_nickname}</span>
              {ev.event_type === 'chat' ? (
                <>: <span>{ev.content}</span></>
              ) : (
                <>
                  {' '}sent{' '}
                  <span className="font-semibold">{ev.gift_name}</span>
                  {ev.gift_repeat_count && ev.gift_repeat_count > 1 ? (
                    <span> (x{ev.gift_repeat_count})</span>
                  ) : null}
                  {ev.gift_diamond_count ? (
                    <span> 💎{ev.gift_diamond_count}</span>
                  ) : null}
                </>
              )}
            </p>
          ))}
        </div>
      )}
    </>
  )

  if (variant === 'panel') {
    return (
      <div className="hidden lg:flex w-80 shrink-0 flex-col border border-border rounded-xl overflow-hidden bg-card self-start max-h-[calc(100vh-6rem)]">
        <div className="px-4 py-3 border-b border-border bg-background flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Chat & Gifts</span>
          {events.length > 0 && (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-green-500" />
          )}
        </div>
        <div className="flex-1 p-3 space-y-3 overflow-y-auto min-h-0">
          {content}
        </div>
      </div>
    )
  }

  // Inline variant — just the content
  return <div className="p-4 space-y-3">{content}</div>
}
