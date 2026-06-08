import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  Trash2,
  StopCircle,
  Play,
  Filter,
  Video,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api, type Recording } from '@/lib/api'
import { formatBytes, formatDuration, formatDate } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'

const statusVariantMap: Record<string, 'default' | 'recording' | 'completed' | 'failed' | 'stopped' | 'pending'> = {
  pending: 'pending',
  recording: 'recording',
  completed: 'completed',
  failed: 'failed',
  stopped: 'stopped',
}

export default function Recordings() {
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [recordDialogOpen, setRecordDialogOpen] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['recordings', page, statusFilter],
    queryFn: () => api.recordings.list(page, 20, statusFilter),
  })

  const recordings = data?.recordings || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / 20)

  const startRecordingMutation = useMutation({
    mutationFn: (username: string) => api.recordings.start({ username }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
      setRecordDialogOpen(false)
      setNewUsername('')
      toast({ title: 'Recording started', description: 'Recording has been started' })
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    },
  })

  const stopRecordingMutation = useMutation({
    mutationFn: (id: number) => api.recordings.stop(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
      toast({ title: 'Recording stopped', description: 'Recording has been stopped' })
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    },
  })

  const deleteRecordingMutation = useMutation({
    mutationFn: (id: number) => api.recordings.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      toast({ title: 'Recording deleted', description: 'Recording has been deleted' })
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    },
  })

  const handleStartRecording = (e: React.FormEvent) => {
    e.preventDefault()
    if (newUsername.trim()) {
      startRecordingMutation.mutate(newUsername.trim())
    }
  }

  const handleDownload = (recording: Recording) => {
    window.open(api.recordings.getDownloadUrl(recording.id), '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-kraken-black tracking-tight">Recordings</h1>
          <p className="text-muted-foreground mt-1">
            View and manage your TikTok live recordings
          </p>
        </div>
        <Dialog open={recordDialogOpen} onOpenChange={setRecordDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Play className="h-4 w-4 mr-2" />
              New Recording
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleStartRecording}>
              <DialogHeader>
                <DialogTitle>Start New Recording</DialogTitle>
                <DialogDescription>
                  Enter a TikTok username to start recording their live stream
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <Input
                  placeholder="@username or username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRecordDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={startRecordingMutation.isPending}>
                  {startRecordingMutation.isPending ? 'Starting...' : 'Start Recording'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Recordings ({total})
            </CardTitle>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                className="text-sm border rounded-lg px-3 py-1.5 bg-white"
                value={statusFilter || ''}
                onChange={(e) => {
                  setStatusFilter(e.target.value || undefined)
                  setPage(1)
                }}
              >
                <option value="">All Status</option>
                <option value="recording">Recording</option>
                <option value="completed">Completed</option>
                <option value="stopped">Stopped</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : recordings.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted-foreground mb-4">No recordings found</p>
              <Button onClick={() => setRecordDialogOpen(true)}>
                <Play className="h-4 w-4 mr-2" />
                Start your first recording
              </Button>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recordings.map((recording: Recording) => (
                    <TableRow key={recording.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">@{recording.username}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {recording.filename}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariantMap[recording.status] || 'default'}>
                          {recording.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDuration(recording.duration_seconds)}</TableCell>
                      <TableCell>{formatBytes(recording.file_size)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(recording.started_at || recording.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {recording.status === 'recording' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => stopRecordingMutation.mutate(recording.id)}
                              disabled={stopRecordingMutation.isPending}
                            >
                              <StopCircle className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                          {recording.status === 'completed' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDownload(recording)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteRecordingMutation.mutate(recording.id)}
                            disabled={deleteRecordingMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
