import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MediaPlayer, MediaProvider } from '@vidstack/react'
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default'
import { Radio, Loader2, Tv, ArrowRight } from 'lucide-react'
import { Button } from '@/components/selia/button'
import { api, ActiveRecording } from '@/lib/api'
import { formatDuration } from '@/lib/utils'

function LiveStreamCard({ recording }: { recording: ActiveRecording }) {
  const navigate = useNavigate()
  const [liveUrl, setLiveUrl] = useState<string | null>(null)
  const [urlError, setUrlError] = useState(false)

  const fetchLiveUrl = useCallback(async () => {
    try {
      setUrlError(false)
      const { live_url } = await api.recordings.getLiveUrl(recording.id)
      console.debug('[Live] stream URL for', recording.username, ':', live_url)
      setLiveUrl(live_url)
    } catch {
      setUrlError(true)
    }
  }, [recording.id])

  useEffect(() => {
    fetchLiveUrl()
    const interval = setInterval(fetchLiveUrl, 30000)
    return () => clearInterval(interval)
  }, [fetchLiveUrl])

  const elapsed = recording.duration_seconds
    ? formatDuration(recording.duration_seconds)
    : '--:--'

  return (
    <div
      className="rounded-xl overflow-hidden bg-card border border-border shadow-sm cursor-pointer group hover:border-primary/50 transition-colors"
      onClick={() => navigate(`/live/${recording.id}`)}
    >
      <div className="relative aspect-video bg-black">
        {liveUrl && !urlError ? (
          <MediaPlayer
            src={{ src: liveUrl, type: 'application/x-mpegurl' }}
            title={`@${recording.username}`}
            className="w-full h-full"
            autoPlay
            muted
          >
            <MediaProvider />
            <DefaultVideoLayout
              icons={defaultLayoutIcons}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </MediaPlayer>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900">
            <Tv className="h-8 w-8 text-gray-500 mb-2" />
            <p className="text-gray-500 text-xs">
              {urlError ? 'Stream unavailable' : 'Loading stream…'}
            </p>
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
          </span>
          LIVE
        </div>
        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
          {elapsed}
        </div>
      </div>
      <div className="p-3 flex items-center justify-between">
        <div className="min-w-0">
          <p className="font-medium text-sm text-foreground truncate">@{recording.username}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Recording #{recording.id}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
      </div>
    </div>
  )
}

export default function Live() {
  const { data: activeRecordings = [], isLoading } = useQuery({
    queryKey: ['activeRecordings'],
    queryFn: () => api.recordings.getActive(),
    refetchInterval: 5000,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
            <Radio className="h-5 w-5 text-red-600 dark:text-red-400" />
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Live Streams</h1>
            <p className="text-sm text-muted-foreground">
              {activeRecordings.length} active {activeRecordings.length === 1 ? 'recording' : 'recordings'}
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
        </div>
      ) : activeRecordings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-border bg-card/50">
          <Tv className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-lg font-medium text-foreground">No active recordings</p>
          <p className="text-sm text-muted-foreground mt-1">
            Start a recording to see live streams here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activeRecordings.map((rec) => (
            <LiveStreamCard key={rec.id} recording={rec} />
          ))}
        </div>
      )}
    </div>
  )
}
