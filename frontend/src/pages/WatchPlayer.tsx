import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { formatBytes, formatDuration, formatDate } from '@/lib/utils'

export default function WatchPlayer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const recordingId = Number(id)

  const { data: recording, isLoading } = useQuery({
    queryKey: ['recording', recordingId],
    queryFn: () => api.recordings.get(recordingId),
    enabled: !isNaN(recordingId),
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

      <div className="rounded-xl overflow-hidden bg-black border border-kraken-border shadow-sm">
        <video
          controls
          className="w-full aspect-video"
          poster={api.recordings.getThumbnailUrl(recording.id)}
          preload="metadata"
        >
          <source src={api.recordings.getStreamUrl(recording.id)} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
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
    </div>
  )
}
