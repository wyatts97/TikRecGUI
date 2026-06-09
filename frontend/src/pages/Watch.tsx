import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Play, Download, Tv, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/utils'
import { useDateFormat } from '@/lib/timezone-context'

export default function Watch() {
  const fmt = useDateFormat()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['recordings', 'watchable'],
    queryFn: () => api.recordings.list(1, 100, 'completed,stopped'),
    refetchInterval: (query) => {
      const recs = query.state.data?.recordings ?? []
      return recs.some((r) => !r.thumbnail_ready) ? 5000 : false
    },
  })

  const recordings = data?.recordings || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground tracking-tight">Watch</h1>
        <p className="text-muted-foreground mt-1">
          Browse and play your completed recordings
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading recordings...</p>
        </div>
      ) : recordings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Tv className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-lg font-medium text-foreground">No recordings yet</p>
          <p className="text-muted-foreground mt-1">
            Start a recording and come back here when it finishes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {recordings.map((recording) => (
            <Card
              key={recording.id}
              className="group overflow-hidden cursor-pointer border border-border bg-card hover:shadow-md transition-shadow"
              onClick={() => navigate(`/watch/${recording.id}`)}
            >
              <div className="relative aspect-video bg-muted overflow-hidden">
                {recording.thumbnail_ready ? (
                  <img
                    src={api.recordings.getThumbnailUrl(recording.id)}
                    alt={`${recording.username} thumbnail`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement
                      img.style.display = 'none'
                      const placeholder = img.nextElementSibling as HTMLElement
                      if (placeholder) placeholder.style.display = 'flex'
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/60">
                    <Loader2 className="h-8 w-8 text-muted-foreground animate-spin mb-2" />
                    <span className="text-xs text-muted-foreground font-medium">Processing…</span>
                  </div>
                )}
                <div className="absolute inset-0 items-center justify-center bg-muted hidden">
                  <Tv className="h-12 w-12 text-gray-400" />
                </div>
                {recording.thumbnail_ready && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="h-12 w-12 rounded-full bg-background/90 flex items-center justify-center">
                      <Play className="h-5 w-5 text-primary ml-0.5" />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 rounded-full bg-primary-subtle flex items-center justify-center shrink-0 overflow-hidden">
                      <img
                        src={api.users.getAvatarUrl(recording.user_id)}
                        alt={recording.username}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement
                          img.style.display = 'none'
                          const fallback = img.nextElementSibling as HTMLElement
                          if (fallback) fallback.style.display = 'flex'
                        }}
                      />
                      <span className="text-xs font-medium text-primary hidden items-center justify-center h-full w-full">
                        {recording.username[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        @{recording.username}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {fmt(recording.ended_at || recording.created_at)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(api.recordings.getDownloadUrl(recording.id), '_blank')
                    }}
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{formatDuration(recording.duration_seconds)}</span>
                  <span>·</span>
                  <span>{formatBytes(recording.file_size)}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
