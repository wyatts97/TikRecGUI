import { useState, useCallback, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Radio, Square, Tv, Calendar, Clock, MessageCircle, Scissors } from 'lucide-react'
import { Button } from '@/components/selia/button'
import { IconBox } from '@/components/selia/icon-box'
import { api } from '@/lib/api'
import { formatDuration } from '@/lib/utils'
import { useDateFormat } from '@/lib/timezone-context'
import ChatPanel from '@/components/ChatPanel'
import FlvPlayer from '@/components/FlvPlayer'
import toast from 'react-hot-toast'

export default function LivePlayer() {
  const fmt = useDateFormat()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const recordingId = Number(id)
  const [showChat, setShowChat] = useState(false)
  const [liveUrl, setLiveUrl] = useState<string | null>(null)
  const [urlError, setUrlError] = useState(false)
  const { data: recording, isLoading } = useQuery({
    queryKey: ['recording', recordingId],
    queryFn: () => api.recordings.get(recordingId),
    enabled: !isNaN(recordingId),
    refetchInterval: 5000,
  })

  const fetchLiveUrl = useCallback(async () => {
    if (isNaN(recordingId)) return
    try {
      setUrlError(false)
      const { live_url } = await api.recordings.getLiveUrl(recordingId)
      console.debug('[LivePlayer] stream URL:', live_url)
      setLiveUrl(live_url)
    } catch {
      setUrlError(true)
    }
  }, [recordingId])

  useEffect(() => {
    fetchLiveUrl()
    const interval = setInterval(fetchLiveUrl, 30000)
    return () => clearInterval(interval)
  }, [fetchLiveUrl])

  const stopMutation = useMutation({
    mutationFn: () => api.recordings.stop(recordingId),
    onSuccess: () => {
      toast.success('Recording stopped')
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
      queryClient.invalidateQueries({ queryKey: ['recording', recordingId] })
    },
    onError: () => {
      toast.error('Failed to stop recording')
    },
  })

  const recordingActive = recording?.status === 'pending' || recording?.status === 'recording'

  const { data: clipStatus } = useQuery({
    queryKey: ['liveClip', recordingId],
    queryFn: () => api.recordings.liveClipStatus(recordingId),
    enabled: !isNaN(recordingId) && !!recordingActive,
    refetchInterval: (q: any) => (q.state.data?.active ? 1000 : false),
  })
  const clipActive = clipStatus?.active ?? false
  const clipElapsed = clipStatus?.elapsed ?? 0

  const startClipMutation = useMutation({
    mutationFn: () => api.recordings.liveClipStart(recordingId),
    onSuccess: () => {
      toast.success('Clip started — recording the live moment')
      queryClient.invalidateQueries({ queryKey: ['liveClip', recordingId] })
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to start clip'),
  })

  const stopClipMutation = useMutation({
    mutationFn: () => api.recordings.liveClipStop(recordingId),
    onSuccess: (res) => {
      toast.success('Clip saved')
      queryClient.invalidateQueries({ queryKey: ['liveClip', recordingId] })
      queryClient.invalidateQueries({ queryKey: ['clips'] })
      if (res.clip_id) {
        toast('View it in Clips', { icon: '🎬' })
      }
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to save clip'),
  })

  const handleSeek = useCallback((seconds: number) => {
    // No-op for live streams — seeking isn't supported
    void seconds
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (!recording) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-lg font-medium text-foreground">Recording not found</p>
        <Button className="mt-4" onClick={() => navigate('/live')}>
          Back to Live
        </Button>
      </div>
    )
  }

  const isActive = recording.status === 'pending' || recording.status === 'recording'
  const elapsed = recording.duration_seconds
    ? formatDuration(recording.duration_seconds)
    : '--:--'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/live')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground tracking-tight truncate">
            @{recording.username}
          </h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            {isActive && (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                </span>
                <span className="text-red-500 font-medium">LIVE</span>
                <span className="mx-1">·</span>
              </>
            )}
            <span>Recording #{recording.id}</span>
          </p>
        </div>
        {isActive && (
          <Button
            variant={clipActive ? 'danger' : 'secondary'}
            size="sm"
            onClick={() => (clipActive ? stopClipMutation.mutate() : startClipMutation.mutate())}
            disabled={startClipMutation.isPending || stopClipMutation.isPending}
            className="shrink-0"
            title={clipActive ? 'Stop and save this clip' : 'Start clipping from the live stream'}
          >
            <Scissors className="h-3.5 w-3.5 mr-1.5" />
            {clipActive ? `Stop Clip · ${formatDuration(clipElapsed)}` : 'Start Clip'}
          </Button>
        )}
        {isActive && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => stopMutation.mutate()}
            disabled={stopMutation.isPending}
            className="shrink-0"
          >
            <Square className="h-3.5 w-3.5 mr-1.5 fill-red-500 text-red-500" />
            Stop
          </Button>
        )}
        <Button
          variant={showChat ? 'default' : 'outline'}
          size="sm"
          className="hidden lg:inline-flex"
          onClick={() => setShowChat((s) => !s)}
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
      </div>

      {/* Main layout */}
      <div className="flex gap-6">
        {/* Left column — player + metadata */}
        <div className="flex-1 min-w-0 space-y-6">
          <div className="rounded-xl overflow-hidden bg-black border border-border shadow-sm">
            {liveUrl && !urlError ? (
              <FlvPlayer
                src={liveUrl}
                className="w-full aspect-video"
                autoPlay
                controls
              />
            ) : (
              <div className="w-full aspect-video flex flex-col items-center justify-center bg-gray-900">
                {urlError ? (
                  <>
                    <Tv className="h-10 w-10 text-gray-500 mb-3" />
                    <p className="text-gray-400 text-sm">Stream unavailable</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={fetchLiveUrl}>
                      Retry
                    </Button>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-10 w-10 text-gray-400 animate-spin mb-3" />
                    <p className="text-gray-400 text-sm">Loading stream…</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Metadata cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="p-4 rounded-xl bg-card border border-border">
              <div className="flex items-center gap-2 mb-1">
                <IconBox variant="secondary-subtle" size="sm">
                  <Calendar className="h-3.5 w-3.5" />
                </IconBox>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Started</p>
              </div>
              <p className="mt-1 font-medium text-foreground">
                {recording.started_at ? fmt(recording.started_at) : '—'}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-card border border-border">
              <div className="flex items-center gap-2 mb-1">
                <IconBox variant="secondary-subtle" size="sm">
                  <Clock className="h-3.5 w-3.5" />
                </IconBox>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Duration</p>
              </div>
              <p className="mt-1 font-medium text-foreground">{elapsed}</p>
            </div>
            <div className="p-4 rounded-xl bg-card border border-border">
              <div className="flex items-center gap-2 mb-1">
                <IconBox variant="secondary-subtle" size="sm">
                  <Radio className="h-3.5 w-3.5" />
                </IconBox>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Status</p>
              </div>
              <p className="mt-1 font-medium text-foreground capitalize">{recording.status}</p>
            </div>
          </div>

          {/* Mobile chat */}
          <div className="lg:hidden border border-border rounded-xl overflow-hidden">
            <div className="flex border-b border-border bg-muted/40">
              <button
                onClick={() => setShowChat(false)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  !showChat
                    ? 'bg-background text-primary border-b-2 border-primary -mb-px'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Player
              </button>
              <button
                onClick={() => setShowChat(true)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                  showChat
                    ? 'bg-background text-primary border-b-2 border-primary -mb-px'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Chat
              </button>
            </div>
            {showChat && (
              <ChatPanel
                recording={recording}
                chatSearch=""
                onChatSearchChange={() => {}}
                onSeek={handleSeek}
                variant="inline"
              />
            )}
          </div>
        </div>

        {/* Desktop sidebar chat */}
        {showChat && (
          <div className="hidden lg:flex lg:flex-col">
            <ChatPanel
              recording={recording}
              chatSearch=""
              onChatSearchChange={() => {}}
              onSeek={handleSeek}
              variant="panel"
            />
          </div>
        )}
      </div>
    </div>
  )
}
