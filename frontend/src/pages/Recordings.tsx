import { useState, useEffect, memo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  Trash2,
  StopCircle,
  Play,
  Filter,
  Video,
  CheckSquare,
  Square,
  Loader2,
  ArrowUp,
  ArrowDown,
  X,
  Images,
} from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/selia/card'
import { Button } from '@/components/selia/button'
import { Badge } from '@/components/selia/badge'
import { Input } from '@/components/selia/input'
import { IconBox } from '@/components/selia/icon-box'
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogBody,
} from '@/components/selia/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/selia/table'
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectList,
} from '@/components/selia/select'
import EmptyState from '@/components/EmptyState'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { api, API_BASE, type Recording } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/utils'
import { useDateFormat } from '@/lib/timezone-context'
import { toast } from 'sonner'

const statusVariantMap: Record<string, 'secondary' | 'info' | 'success' | 'danger' | 'secondary-outline'> = {
  pending: 'secondary',
  recording: 'info',
  completed: 'success',
  failed: 'danger',
  stopped: 'secondary-outline',
}

// Memoized recording row
const RecordingRow = memo(function RecordingRow({
  recording,
  selectedIds,
  stopPending,
  deletePending,
  onToggleSelect,
  onStop,
  onDownload,
  onDelete,
  fmt,
}: {
  recording: Recording
  selectedIds: Set<number>
  stopPending: boolean
  deletePending: boolean
  onToggleSelect: (id: number) => void
  onStop: (id: number) => void
  onDownload: (recording: Recording) => void
  onDelete: (id: number) => void
  fmt: (date: string | null | undefined) => string
}) {
  return (
    <TableRow key={recording.id}>
      <TableCell>
        <button
          onClick={() => onToggleSelect(recording.id)}
          className="flex items-center justify-center"
        >
          {selectedIds.has(recording.id) ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </TableCell>
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
      <TableCell>
        {recording.transcript_status === 'done' ? (
          <Badge variant="success" className="text-xs">Done</Badge>
        ) : recording.transcript_status === 'processing' ? (
          <Badge variant="warning" className="text-xs">Processing</Badge>
        ) : recording.transcript_status === 'pending' ? (
          <Badge variant="secondary" className="text-xs">Pending</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>{formatDuration(recording.duration_seconds)}</TableCell>
      <TableCell>{formatBytes(recording.file_size)}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {fmt(recording.started_at || recording.created_at)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {recording.status === 'recording' && (
            <button onClick={() => onStop(recording.id)} disabled={stopPending}>
              <IconBox variant="danger-subtle" size="sm">
                <StopCircle className="h-4 w-4" />
              </IconBox>
            </button>
          )}
          {(recording.status === 'completed' || recording.status === 'stopped') && (
            <button onClick={() => onDownload(recording)}>
              <IconBox variant="primary-subtle" size="sm">
                <Download className="h-4 w-4" />
              </IconBox>
            </button>
          )}
          <button onClick={() => onDelete(recording.id)} disabled={deletePending}>
            <IconBox variant="danger-subtle" size="sm">
              <Trash2 className="h-4 w-4" />
            </IconBox>
          </button>
        </div>
      </TableCell>
    </TableRow>
  )
})

// Mobile recording card
const RecordingCard = memo(function RecordingCard({
  recording,
  selectedIds,
  onToggleSelect,
  onStop,
  onDownload,
  onDelete,
  stopPending,
  deletePending,
  fmt,
}: {
  recording: Recording
  selectedIds: Set<number>
  stopPending: boolean
  deletePending: boolean
  onToggleSelect: (id: number) => void
  onStop: (id: number) => void
  onDownload: (recording: Recording) => void
  onDelete: (id: number) => void
  fmt: (date: string | null | undefined) => string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => onToggleSelect(recording.id)} className="shrink-0">
            {selectedIds.has(recording.id) ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <div>
            <p className="font-medium text-sm">@{recording.username}</p>
            <p className="text-xs text-muted-foreground truncate max-w-[180px]">
              {recording.filename}
            </p>
          </div>
        </div>
        <Badge variant={statusVariantMap[recording.status] || 'default'} className="shrink-0">
          {recording.status}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Duration: {formatDuration(recording.duration_seconds)}</span>
        <span>Size: {formatBytes(recording.file_size)}</span>
        <span>{fmt(recording.started_at || recording.created_at)}</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          {recording.transcript_status === 'done' ? (
            <Badge variant="success" className="text-[10px]">Transcript: Done</Badge>
          ) : recording.transcript_status === 'processing' ? (
            <Badge variant="warning" className="text-[10px]">Transcript: Processing</Badge>
          ) : recording.transcript_status === 'pending' ? (
            <Badge variant="secondary" className="text-[10px]">Transcript: Pending</Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground">No transcript</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {recording.status === 'recording' && (
            <button onClick={() => onStop(recording.id)} disabled={stopPending}>
              <IconBox variant="danger-subtle" size="sm">
                <StopCircle className="h-3.5 w-3.5" />
              </IconBox>
            </button>
          )}
          {(recording.status === 'completed' || recording.status === 'stopped') && (
            <button onClick={() => onDownload(recording)}>
              <IconBox variant="primary-subtle" size="sm">
                <Download className="h-3.5 w-3.5" />
              </IconBox>
            </button>
          )}
          <button onClick={() => onDelete(recording.id)} disabled={deletePending}>
            <IconBox variant="danger-subtle" size="sm">
              <Trash2 className="h-3.5 w-3.5" />
            </IconBox>
          </button>
        </div>
      </div>
    </div>
  )
})

export default function Recordings() {
  const fmt = useDateFormat()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(() => {
    const p = searchParams.get('page')
    return p ? parseInt(p) : 1
  })
  const [statusFilter, setStatusFilter] = useState<string | undefined>(() => {
    return searchParams.get('status') || undefined
  })
  const [sortBy, setSortBy] = useState(() => searchParams.get('sortBy') || 'date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    return (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc'
  })
  const [usernameFilter, setUsernameFilter] = useState(() => searchParams.get('username') || '')
  const [minSizeMb, setMinSizeMb] = useState(() => searchParams.get('minSize') || '')
  const [maxSizeMb, setMaxSizeMb] = useState(() => searchParams.get('maxSize') || '')
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || '')
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || '')
  const [recordDialogOpen, setRecordDialogOpen] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const queryClient = useQueryClient()

  // Sync state to URL search params
  useEffect(() => {
    const params = new URLSearchParams()
    if (page > 1) params.set('page', String(page))
    if (statusFilter) params.set('status', statusFilter)
    if (sortBy !== 'date') params.set('sortBy', sortBy)
    if (sortOrder !== 'desc') params.set('sortOrder', sortOrder)
    if (usernameFilter) params.set('username', usernameFilter)
    if (minSizeMb) params.set('minSize', minSizeMb)
    if (maxSizeMb) params.set('maxSize', maxSizeMb)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    setSearchParams(params, { replace: true })
  }, [page, statusFilter, sortBy, sortOrder, usernameFilter, minSizeMb, maxSizeMb, dateFrom, dateTo, setSearchParams])

  const { data, isLoading } = useQuery({
    queryKey: ['recordings', page, statusFilter, sortBy, sortOrder, usernameFilter, minSizeMb, maxSizeMb, dateFrom, dateTo],
    queryFn: () => api.recordings.list(page, 20, statusFilter, undefined, {
      sortBy,
      sortOrder,
      usernameFilter: usernameFilter || undefined,
      minSize: minSizeMb ? Math.round(parseFloat(minSizeMb) * 1024 * 1024) : undefined,
      maxSize: maxSizeMb ? Math.round(parseFloat(maxSizeMb) * 1024 * 1024) : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
  })

  const hasActiveFilters = usernameFilter || minSizeMb || maxSizeMb || dateFrom || dateTo || statusFilter

  const clearFilters = useCallback(() => {
    setStatusFilter(undefined)
    setUsernameFilter('')
    setMinSizeMb('')
    setMaxSizeMb('')
    setDateFrom('')
    setDateTo('')
    setSortBy('date')
    setSortOrder('desc')
    setPage(1)
  }, [])

  const recordings = data?.recordings || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / 20)

  const advancedFilterCount = [usernameFilter, minSizeMb, maxSizeMb, dateFrom, dateTo].filter(Boolean).length

  const startRecordingMutation = useMutation({
    mutationFn: (username: string) => api.recordings.start({ username }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
      setRecordDialogOpen(false)
      setNewUsername('')
      toast('Recording started', { description: 'Recording has been started' })
    },
    onError: (error: Error) => {
      toast.error('Error', { description: error.message })
    },
  })

  const stopRecordingMutation = useMutation({
    mutationFn: (id: number) => api.recordings.stop(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
      toast('Recording stopped', { description: 'Recording has been stopped' })
    },
    onError: (error: Error) => {
      toast.error('Error', { description: error.message })
    },
  })

  const deleteRecordingMutation = useMutation({
    mutationFn: (id: number) => api.recordings.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      toast('Recording deleted', { description: 'Recording has been deleted' })
    },
    onError: (error: Error) => {
      toast.error('Error', { description: error.message })
    },
  })

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.recordings.batchDelete(ids),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      setSelectedIds(new Set())
      setDeleteConfirmOpen(false)
      toast('Recordings deleted', {
        description: `${data.deleted} recording(s) deleted${data.errors.length > 0 ? `, ${data.errors.length} error(s)` : ''}`
      })
    },
    onError: (error: Error) => {
      toast.error('Error', { description: error.message })
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

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id)) newSet.delete(id)
      else newSet.add(id)
      return newSet
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === recordings.length) return new Set()
      return new Set(recordings.map(r => r.id))
    })
  }, [recordings])

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0) return
    setIsDownloading(true)
    try {
      const blob = await api.recordings.batchDownload(Array.from(selectedIds))
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recordings_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast('Download started', { description: 'Your recordings are being downloaded' })
    } catch (error) {
      toast.error('Error', { description: (error as Error).message })
    } finally {
      setIsDownloading(false)
    }
  }

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return
    batchDeleteMutation.mutate(Array.from(selectedIds))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Recordings</h1>
          <p className="text-muted-foreground mt-1">
            View and manage your TikTok live recordings
          </p>
        </div>
        <Dialog open={recordDialogOpen} onOpenChange={setRecordDialogOpen}>
          <DialogTrigger>
            <Button>
              <Play className="h-4 w-4 mr-2" />
              New Recording
            </Button>
          </DialogTrigger>
          <DialogPopup>
            <form onSubmit={handleStartRecording}>
              <DialogHeader>
                <DialogTitle>Start New Recording</DialogTitle>
                <DialogDescription>
                  Enter a TikTok username to start recording their live stream
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <div className="space-y-4">
                  <Input
                    placeholder="@username or username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                  />
                </div>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRecordDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={startRecordingMutation.isPending}>
                  {startRecordingMutation.isPending ? 'Starting...' : 'Start Recording'}
                </Button>
              </DialogFooter>
            </form>
          </DialogPopup>
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
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/recordings/sprites/regenerate`, { method: 'POST' })
                    const data = await res.json()
                    alert(`Triggered sprite generation for ${data.triggered} missing recordings`)
                  } catch {
                    alert('Failed to trigger sprite regeneration')
                  }
                }}
              >
                <Images className="h-3 w-3 mr-1" />
                Regenerate Sprites
              </Button>
              {hasActiveFilters && (
                <Button variant="plain" size="sm" onClick={clearFilters} className="text-xs">
                  <X className="h-3 w-3 mr-1" />
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Select
                value={statusFilter || 'all'}
                onValueChange={(v) => { setStatusFilter(v === 'all' ? undefined : v); setPage(1) }}
              >
                <SelectTrigger className="h-8 w-32 text-sm">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectPopup>
                  <SelectList>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="recording">Recording</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="stopped">Stopped</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectList>
                </SelectPopup>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Sort:</span>
              <Select
                value={sortBy}
                onValueChange={(v) => { setSortBy(v); setPage(1) }}
              >
                <SelectTrigger className="h-8 w-28 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectList>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="size">Size</SelectItem>
                    <SelectItem value="duration">Duration</SelectItem>
                    <SelectItem value="username">User</SelectItem>
                  </SelectList>
                </SelectPopup>
              </Select>
              <button
                onClick={() => { setSortOrder((o: 'asc' | 'desc') => o === 'asc' ? 'desc' : 'asc'); setPage(1) }}
                className="flex items-center justify-center h-8 w-8 rounded-lg border bg-background hover:bg-muted/60 transition-colors"
                title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs relative"
              onClick={() => setShowAdvancedFilters((s) => !s)}
            >
              <Filter className="h-3.5 w-3.5 mr-1" />
              Filters
              {advancedFilterCount > 0 && (
                <span className="ml-1.5 h-4 min-w-[1rem] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium flex items-center justify-center">
                  {advancedFilterCount}
                </span>
              )}
            </Button>
          </div>

          {showAdvancedFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border mt-2">
              <Input
                placeholder="Filter by user…"
                value={usernameFilter}
                onChange={(e) => { setUsernameFilter(e.target.value); setPage(1) }}
                className="h-8 w-36 text-sm"
              />

              <div className="flex items-center gap-1">
                <Input
                  placeholder="Min MB"
                  type="number"
                  min="0"
                  value={minSizeMb}
                  onChange={(e) => { setMinSizeMb(e.target.value); setPage(1) }}
                  className="h-8 w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  placeholder="Max MB"
                  type="number"
                  min="0"
                  value={maxSizeMb}
                  onChange={(e) => { setMaxSizeMb(e.target.value); setPage(1) }}
                  className="h-8 w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">MB</span>
              </div>

              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                  className="text-sm border rounded-lg px-2 py-1 bg-background h-8"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                  className="text-sm border rounded-lg px-2 py-1 bg-background h-8"
                />
              </div>
            </div>
          )}
        </CardHeader>
        <CardBody>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : recordings.length === 0 ? (
            <EmptyState
              icon={Video}
              title="No recordings found"
              description="Start a recording to capture TikTok live streams"
              actionLabel="Start your first recording"
              onAction={() => setRecordDialogOpen(true)}
            />
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 mb-4 p-3 bg-primary-subtle rounded-lg">
                  <span className="text-sm font-medium">
                    {selectedIds.size} selected
                  </span>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBatchDownload}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Download ZIP
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              )}

              {/* Desktop table */}
              {isDesktop ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <button
                          onClick={toggleSelectAll}
                          className="flex items-center justify-center"
                        >
                          {selectedIds.size === recordings.length && recordings.length > 0 ? (
                            <CheckSquare className="h-4 w-4 text-primary" />
                          ) : (
                            <Square className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Transcript</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordings.map((recording: Recording) => (
                      <RecordingRow
                        key={recording.id}
                        recording={recording}
                        selectedIds={selectedIds}
                        stopPending={stopRecordingMutation.isPending}
                        deletePending={deleteRecordingMutation.isPending}
                        onToggleSelect={toggleSelect}
                        onStop={(id) => stopRecordingMutation.mutate(id)}
                        onDownload={handleDownload}
                        onDelete={(id) => deleteRecordingMutation.mutate(id)}
                        fmt={fmt}
                      />
                    ))}
                  </TableBody>
                </Table>
              ) : (
                /* Mobile cards */
                <div className="space-y-3">
                  {recordings.map((recording: Recording) => (
                    <RecordingCard
                      key={recording.id}
                      recording={recording}
                      selectedIds={selectedIds}
                      stopPending={stopRecordingMutation.isPending}
                      deletePending={deleteRecordingMutation.isPending}
                      onToggleSelect={toggleSelect}
                      onStop={(id) => stopRecordingMutation.mutate(id)}
                      onDownload={handleDownload}
                      onDelete={(id) => deleteRecordingMutation.mutate(id)}
                      fmt={fmt}
                    />
                  ))}
                </div>
              )}

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
        </CardBody>
      </Card>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} Recording(s)?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The selected recordings and their files will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">Are you sure you want to delete {selectedIds.size} recording(s)?</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleBatchDelete}
              disabled={batchDeleteMutation.isPending}
            >
              {batchDeleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
