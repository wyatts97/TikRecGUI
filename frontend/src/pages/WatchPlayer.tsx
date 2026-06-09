import React, { useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MediaPlayer, MediaProvider } from '@vidstack/react'
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import { ArrowLeft, Download, Loader2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/utils'
import { useDateFormat } from '@/lib/timezone-context'
import TranscriptPanel from '@/components/TranscriptPanel'

function downloadAsFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function formatTranscriptAsSrt(transcriptText: string): string {
  const lines = transcriptText.split('\n').filter(Boolean)
  const entries: string[] = []
  let index = 1
  for (const line of lines) {
    const match = line.match(/\[(\d{2}:\d{2}(?::\d{2})?)\]\s*(.*)/)
    if (match) {
      const ts = match[1]
      const text = match[2]
      // Pad timestamp parts to SRT format: 00:00:00,000
      const parts = ts.split(':')
      let hh = '00', mm = '00', ss = '00'
      if (parts.length === 3) {
        hh = parts[0]; mm = parts[1]; ss = parts[2]
      } else if (parts.length === 2) {
        mm = parts[0]; ss = parts[1]
      }
      const start = `${hh}:${mm}:${ss},000`
      // Estimate end time (next entry or +3s)
      entries.push(`${index}\n${start} --> ?\n${text}\n`)
      index++
    }
  }
  return entries.join('\n')
}

function formatTranscriptAsTxt(transcriptText: string): string {
  return transcriptText
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/\[\d{2}:\d{2}(?::\d{2})?\]\s*/, ''))
    .join('\n')
}

export default function WatchPlayer() {
  const fmt = useDateFormat()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const recordingId = Number(id)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'player' | 'transcript'>('player')
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const playerRef = useRef<HTMLMediaElement>(null)

  const { data: recording, isLoading } = useQuery({
    queryKey: ['recording', recordingId],
    queryFn: () => api.recordings.get(recordingId),
    enabled: !isNaN(recordingId),
    refetchInterval: (query: any) => {
      const rec = query.state.data
      if (!rec) return false
      if (rec.transcript_status === 'processing' || rec.transcript_status === 'pending') return 3000
      if (!rec.sprite_ready) return 5000
      return false
    },
  })

  const transcribeMutation = useMutation({
    mutationFn: () => api.recordings.transcribe(recordingId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recording', recordingId] }),
  })

  const handleSeek = useCallback((seconds: number) => {
    const video = playerRef.current?.querySelector('video') as HTMLVideoElement | null
    if (video) video.currentTime = seconds
  }, [])

  const handleDownloadSrt = useCallback(() => {
    if (!recording?.transcript_text) return
    const srt = formatTranscriptAsSrt(recording.transcript_text)
    const baseName = recording.filename?.replace(/\.[^.]+$/, '') || `recording_${recording.id}`
    downloadAsFile(srt, `${baseName}.srt`, 'text/plain')
  }, [recording])

  const handleDownloadTxt = useCallback(() => {
    if (!recording?.transcript_text) return
    const txt = formatTranscriptAsTxt(recording.transcript_text)
    const baseName = recording.filename?.replace(/\.[^.]+$/, '') || `recording_${recording.id}`
    downloadAsFile(txt, `${baseName}.txt`, 'text/plain')
  }, [recording])

  const transcriptActions = useMemo(() => {
    if (!recording?.transcript_text || recording.transcript_status !== 'done') return null
    return (
      <div className="flex items-center gap-2 mt-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleDownloadSrt}
          className="text-xs"
        >
          <Download className="h-3 w-3 mr-1" />
          Download SRT
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDownloadTxt}
          className="text-xs"
        >
          <FileText className="h-3 w-3 mr-1" />
          Download TXT
        </Button>
      </div>
    )
  }, [recording, handleDownloadSrt, handleDownloadTxt])

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
        <p className="text-lg font-medium text-foreground">Recording not found</p>
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
        <h1 className="text-2xl font-bold text-foreground tracking-tight truncate">
          @{recording.username}
        </h1>
      </div>

      {!recording.thumbnail_ready && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
          <Loader2 className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
            Video is still being processed. It will be available shortly.
          </p>
        </div>
      )}

      <div className="flex gap-6">
        {/* Left column */}
        <div className="flex-1 min-w-0 space-y-6">
          <div className="rounded-xl overflow-hidden bg-black border border-border shadow-sm" ref={playerRef}>
            {recording.thumbnail_ready ? (
              <MediaPlayer
                src={api.recordings.getStreamUrl(recording.id)}
                poster={api.recordings.getThumbnailUrl(recording.id)}
                title={`@${recording.username}`}
                className="w-full aspect-video"
              >
                <MediaProvider />
                <DefaultVideoLayout
                  icons={defaultLayoutIcons}
                  thumbnails={recording.sprite_ready ? api.recordings.getSpriteVttUrl(recording.id) : undefined}
                />
              </MediaPlayer>
            ) : (
              <div className="w-full aspect-video flex flex-col items-center justify-center bg-gray-900">
                <Loader2 className="h-10 w-10 text-gray-400 animate-spin mb-3" />
                <p className="text-gray-400 text-sm">Processing video…</p>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="p-4 rounded-xl bg-card border border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Recorded</p>
              <p className="mt-1 font-medium text-foreground">
                {fmt(recording.ended_at || recording.created_at)}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-card border border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Duration</p>
              <p className="mt-1 font-medium text-foreground">
                {formatDuration(recording.duration_seconds)}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-card border border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Size</p>
              <p className="mt-1 font-medium text-foreground">
                {formatBytes(recording.file_size)}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-card border border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Filename</p>
              <p className="mt-1 font-medium text-foreground truncate" title={recording.filename}>
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

          {/* Mobile transcript tab */}
          <div className="border border-border rounded-xl overflow-hidden lg:hidden">
            <div className="flex border-b border-border bg-muted/40">
              <button
                onClick={() => setActiveTab('player')}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === 'player'
                    ? 'bg-background text-primary border-b-2 border-primary -mb-px'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Player
              </button>
              <button
                onClick={() => setActiveTab('transcript')}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === 'transcript'
                    ? 'bg-background text-primary border-b-2 border-primary -mb-px'
                    : 'text-muted-foreground hover:text-foreground'
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
              <div>
                <TranscriptPanel
                  recording={recording}
                  transcriptSearch={transcriptSearch}
                  onTranscriptSearchChange={setTranscriptSearch}
                  onTranscribe={() => transcribeMutation.mutate()}
                  isTranscribing={transcribeMutation.isPending}
                  onSeek={handleSeek}
                  variant="inline"
                />
                {transcriptActions}
              </div>
            )}
          </div>
        </div>

        {/* Desktop transcript panel */}
        <div className="hidden lg:flex lg:flex-col">
          {activeTab === 'transcript' && (
            <div>
              <TranscriptPanel
                recording={recording}
                transcriptSearch={transcriptSearch}
                onTranscriptSearchChange={setTranscriptSearch}
                onTranscribe={() => transcribeMutation.mutate()}
                isTranscribing={transcribeMutation.isPending}
                onSeek={handleSeek}
                variant="panel"
              />
              {transcriptActions}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
