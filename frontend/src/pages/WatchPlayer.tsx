import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MediaPlayer, MediaProvider, Track } from '@vidstack/react'
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import { ArrowLeft, Download, Loader2, FileText, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { formatBytes, formatDuration, formatDate } from '@/lib/utils'

export default function WatchPlayer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const recordingId = Number(id)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'player' | 'transcript'>('player')
  const [transcriptSearch, setTranscriptSearch] = useState('')

  const { data: recording, isLoading } = useQuery({
    queryKey: ['recording', recordingId],
    queryFn: () => api.recordings.get(recordingId),
    enabled: !isNaN(recordingId),
    refetchInterval: (query: { state: { data: typeof recording } }) => {
      const rec = query.state.data
      if (!rec) return false
      if (rec.transcript_status === 'processing' || rec.transcript_status === 'pending') return 3000
      return false
    },
  })

  const transcribeMutation = useMutation({
    mutationFn: () => api.recordings.transcribe(recordingId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recording', recordingId] }),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!recording) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-lg font-medium text-kraken-black">Recording not found</p>
        <Button className="mt-4" onClick={() => navigate('/watch')}>
          Back to Watch
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/watch')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold text-kraken-black tracking-tight truncate">
          @{recording.username}
        </h1>
      </div>

      {!recording.thumbnail_ready && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
          <Loader2 className="h-4 w-4 text-amber-600 animate-spin shrink-0" />
          <p className="text-sm text-amber-800 font-medium">
            Video is still being processed. It will be available shortly.
          </p>
        </div>
      )}

      <div className="rounded-xl overflow-hidden bg-black border border-kraken-border shadow-sm">
        {recording.thumbnail_ready ? (
          <MediaPlayer
            src={api.recordings.getStreamUrl(recording.id)}
            poster={api.recordings.getThumbnailUrl(recording.id)}
            title={`@${recording.username}`}
            className="w-full aspect-video"
          >
            <MediaProvider>
              <Track
                src={api.recordings.getSpriteVttUrl(recording.id)}
                kind="thumbnails"
                default
              />
            </MediaProvider>
            <DefaultVideoLayout icons={defaultLayoutIcons} />
          </MediaPlayer>
        ) : (
          <div className="w-full aspect-video flex flex-col items-center justify-center bg-gray-900">
            <Loader2 className="h-10 w-10 text-gray-400 animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Processing video…</p>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="p-4 rounded-xl bg-white border border-kraken-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Recorded</p>
          <p className="mt-1 font-medium text-kraken-black">
            {formatDate(recording.ended_at || recording.created_at)}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-white border border-kraken-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Duration</p>
          <p className="mt-1 font-medium text-kraken-black">
            {formatDuration(recording.duration_seconds)}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-white border border-kraken-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Size</p>
          <p className="mt-1 font-medium text-kraken-black">
            {formatBytes(recording.file_size)}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-white border border-kraken-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Filename</p>
          <p className="mt-1 font-medium text-kraken-black truncate" title={recording.filename}>
            {recording.filename}
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => window.open(api.recordings.getDownloadUrl(recording.id), '_blank')}
        >
          <Download className="h-4 w-4 mr-2" />
          Download
        </Button>
      </div>

      <div className="border border-kraken-border rounded-xl overflow-hidden">
        <div className="flex border-b border-kraken-border bg-gray-50">
          <button
            onClick={() => setActiveTab('player')}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'player'
                ? 'bg-white text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-kraken-black'
            }`}
          >
            Player
          </button>
          <button
            onClick={() => setActiveTab('transcript')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'transcript'
                ? 'bg-white text-primary border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-kraken-black'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Transcript
            {recording.transcript_status === 'done' && (
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500" />
            )}
          </button>
        </div>

        {activeTab === 'transcript' && (
          <div className="p-4 space-y-3">
            {!recording.transcript_status && (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No transcript yet</p>
                <Button
                  size="sm"
                  onClick={() => transcribeMutation.mutate()}
                  disabled={transcribeMutation.isPending || recording.status === 'recording'}
                >
                  {transcribeMutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Starting…</>
                  ) : (
                    'Transcribe'
                  )}
                </Button>
              </div>
            )}

            {(recording.transcript_status === 'pending' || recording.transcript_status === 'processing') && (
              <div className="flex items-center gap-2 py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground capitalize">
                  {recording.transcript_status}…
                </p>
              </div>
            )}

            {recording.transcript_status === 'failed' && (
              <div className="flex flex-col items-center gap-2 py-6">
                <p className="text-sm text-red-600">Transcription failed.</p>
                <Button size="sm" variant="outline" onClick={() => transcribeMutation.mutate()}>
                  Retry
                </Button>
              </div>
            )}

            {recording.transcript_status === 'done' && recording.transcript_text && (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search transcript…"
                      value={transcriptSearch}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTranscriptSearch(e.target.value)}
                      className="pl-8 h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto rounded-lg border border-kraken-border bg-gray-50 p-3 space-y-1 font-mono text-xs">
                  {recording.transcript_text
                    .split('\n')
                    .filter((line: string) => !transcriptSearch || line.toLowerCase().includes(transcriptSearch.toLowerCase()))
                    .map((line: string, i: number) => (
                      <p
                        key={i}
                        className={`leading-relaxed ${
                          transcriptSearch && line.toLowerCase().includes(transcriptSearch.toLowerCase())
                            ? 'bg-yellow-100 rounded px-1'
                            : ''
                        }`}
                      >
                        {line}
                      </p>
                    ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
