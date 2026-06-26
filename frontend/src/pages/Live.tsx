import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Radio, Tv, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react'
import { Button } from '@/components/selia/button'
import { api, ActiveRecording } from '@/lib/api'
import { formatDuration } from '@/lib/utils'
import FlvPlayer from '@/components/FlvPlayer'
import EmptyState from '@/components/EmptyState'
import { VideoGridSkeleton } from '@/components/Skeleton'
import { StaggerContainer, StaggerItem } from '@/components/motion'

function LiveStreamCard({ recording }: { recording: ActiveRecording }) {
  const navigate = useNavigate()
  const [liveUrl, setLiveUrl] = useState<string | null>(null)
  const [streamType, setStreamType] = useState<'hls' | 'flv' | 'rtmp'>('flv')
  const [urlError, setUrlError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [playerError, setPlayerError] = useState(false)

  const fetchLiveUrl = useCallback(async () => {
    setIsLoading(true)
    setUrlError(false)
    try {
      const { live_url, type } = await api.recordings.getLiveUrl(recording.id)
      console.debug('[Live] stream URL for', recording.username, ':', live_url, type)
      setLiveUrl(live_url)
      setStreamType(type)
      setPlayerError(false)
    } catch {
      setUrlError(true)
    } finally {
      setIsLoading(false)
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

  const showPlayer = liveUrl && !urlError && !playerError
  const showError = urlError || playerError

  return (
    <div
      className="rounded-xl overflow-hidden bg-card border border-border shadow-sm cursor-pointer group hover:border-primary/50 hover:shadow-md transition-all"
      onClick={() => navigate(`/live/${recording.id}`)}
    >
      <div className="relative aspect-video bg-black">
        {showPlayer ? (
          <div className="w-full h-full" onClick={(e) => e.stopPropagation()}>
            <FlvPlayer
              src={liveUrl}
              type={streamType}
              className="w-full h-full"
              autoPlay
              muted
              controls={false}
              onError={() => setPlayerError(true)}
              onReady={() => setPlayerError(false)}
            />
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900">
            {showError ? (
              <>
                <AlertCircle className="h-8 w-8 text-red-500 mb-2" />
                <p className="text-red-400 text-xs mb-2">Stream unavailable</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    fetchLiveUrl()
                  }}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Retry
                </Button>
              </>
            ) : (
              <>
                <Tv className="h-8 w-8 text-gray-500 mb-2 animate-pulse" />
                <p className="text-gray-500 text-xs">Loading stream…</p>
              </>
            )}
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
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
  const queryClient = useQueryClient()
  const { data: activeRecordings = [], isLoading } = useQuery({
    queryKey: ['activeRecordings'],
    queryFn: () => api.recordings.getActive(),
    refetchInterval: 5000,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
  }

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
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <VideoGridSkeleton count={6} className="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3" />
      ) : activeRecordings.length === 0 ? (
        <EmptyState
          icon={Tv}
          title="No active recordings"
          description="Start a recording to see live streams here."
        />
      ) : (
        <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activeRecordings.map((rec) => (
            <StaggerItem key={rec.id}>
              <LiveStreamCard recording={rec} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}
    </div>
  )
}
