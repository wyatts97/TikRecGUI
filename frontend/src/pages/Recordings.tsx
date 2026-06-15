import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  Trash2,
  StopCircle,
  Play,
  Video,
  Loader2,
} from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/selia/card'
import { Button } from '@/components/selia/button'
import { Badge } from '@/components/selia/badge'
import { Input } from '@/components/selia/input'
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
import DataTable from 'react-data-table-component'
import EmptyState from '@/components/EmptyState'
import { api, type Recording } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/utils'
import { useDateFormat } from '@/lib/timezone-context'
import toast from 'react-hot-toast'

const statusVariantMap: Record<string, 'secondary' | 'info' | 'success' | 'danger' | 'secondary-outline'> = {
  pending: 'secondary',
  recording: 'info',
  completed: 'success',
  failed: 'danger',
  stopped: 'secondary-outline',
}

const customStyles = {
  table: { style: { backgroundColor: 'transparent' } },
  headRow: {
    style: {
      backgroundColor: 'var(--table-head)',
      color: 'var(--foreground)',
      fontSize: '0.875rem',
      fontWeight: 500,
      borderBottom: '1px solid var(--border)',
    },
  },
  headCells: {
    style: { paddingLeft: '16px', paddingRight: '16px' },
  },
  rows: {
    style: {
      backgroundColor: 'var(--card)',
      color: 'var(--foreground)',
      fontSize: '0.875rem',
      minHeight: '56px',
      borderBottom: 'none',
    },
    stripedStyle: {
      backgroundColor: 'var(--table-accent)',
    },
    highlightOnHoverStyle: {
      backgroundColor: 'var(--table-head)',
      transitionDuration: '150ms',
      transitionProperty: 'background-color',
      borderBottom: 'none',
    },
  },
  cells: {
    style: { paddingLeft: '16px', paddingRight: '16px' },
  },
  pagination: {
    style: {
      backgroundColor: 'var(--card)',
      color: 'var(--foreground)',
      borderTop: '1px solid var(--border)',
      fontSize: '0.875rem',
    },
    pageButtonsStyle: {
      color: 'var(--foreground)',
      fill: 'var(--foreground)',
      backgroundColor: 'transparent',
      borderRadius: '0.5rem',
      height: '36px',
      padding: '0 12px',
      margin: '0 2px',
      cursor: 'pointer',
      transition: 'all 150ms',
    },
  },
  paginationRowsPerPage: {
    style: {
      color: 'var(--foreground)',
      backgroundColor: 'var(--card)',
    },
  },
  paginationSelect: {
    style: {
      color: 'var(--foreground)',
      backgroundColor: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: '0.5rem',
      padding: '4px 8px',
    },
  },
  contextMenu: {
    style: {
      backgroundColor: 'var(--card)',
      color: 'var(--foreground)',
      border: '1px solid var(--border)',
      borderRadius: '0.5rem',
      boxShadow: 'var(--shadow-card)',
    },
  },
  subHeader: {
    style: {
      backgroundColor: 'transparent',
      padding: '0 0 12px 0',
    },
  },
  responsiveWrapper: {
    style: {
      borderRadius: '0',
    },
  },
}

export default function Recordings() {
  const fmt = useDateFormat()
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(() => {
    const p = searchParams.get('page')
    return p ? parseInt(p) : 1
  })
  const [perPage, setPerPage] = useState(() => {
    const pp = searchParams.get('perPage')
    return pp ? parseInt(pp) : 20
  })
  const [statusFilter, setStatusFilter] = useState<string | undefined>(() => {
    return searchParams.get('status') || undefined
  })
  const [sortBy, setSortBy] = useState(() => searchParams.get('sortBy') || 'date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    return (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc'
  })
  const [usernameFilter, setUsernameFilter] = useState(() => searchParams.get('username') || '')
  const [recordDialogOpen, setRecordDialogOpen] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const queryClient = useQueryClient()

  // Sync state to URL search params
  useEffect(() => {
    const params = new URLSearchParams()
    if (page > 1) params.set('page', String(page))
    if (perPage !== 20) params.set('perPage', String(perPage))
    if (statusFilter) params.set('status', statusFilter)
    if (sortBy !== 'date') params.set('sortBy', sortBy)
    if (sortOrder !== 'desc') params.set('sortOrder', sortOrder)
    if (usernameFilter) params.set('username', usernameFilter)
    setSearchParams(params, { replace: true })
  }, [page, perPage, statusFilter, sortBy, sortOrder, usernameFilter, setSearchParams])

  const { data, isLoading } = useQuery({
    queryKey: ['recordings', page, perPage, statusFilter, sortBy, sortOrder, usernameFilter],
    queryFn: () => api.recordings.list(page, perPage, statusFilter, undefined, {
      sortBy,
      sortOrder,
      usernameFilter: usernameFilter || undefined,
    }),
  })

  const hasActiveFilters = !!usernameFilter || !!statusFilter

  const clearFilters = useCallback(() => {
    setStatusFilter(undefined)
    setUsernameFilter('')
    setSortBy('date')
    setSortOrder('desc')
    setPage(1)
  }, [])

  const recordings = data?.recordings || []
  const total = data?.total || 0

  const startRecordingMutation = useMutation({
    mutationFn: (username: string) => api.recordings.start({ username }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
      setRecordDialogOpen(false)
      setNewUsername('')
      toast.success('Recording started')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const stopRecordingMutation = useMutation({
    mutationFn: (id: number) => api.recordings.stop(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
      toast.success('Recording stopped')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const deleteRecordingMutation = useMutation({
    mutationFn: (id: number) => api.recordings.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      toast.success('Recording deleted')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.recordings.batchDelete(ids),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      setSelectedIds(new Set())
      setDeleteConfirmOpen(false)
      toast.success(`${data.deleted} recording(s) deleted${data.errors.length > 0 ? `, ${data.errors.length} error(s)` : ''}`)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleStartRecording = (e: React.FormEvent) => {
    e.preventDefault()
    if (newUsername.trim()) {
      startRecordingMutation.mutate(newUsername.trim())
    }
  }

  const handleDownload = (recording: Recording) => {
    const a = document.createElement('a')
    a.href = api.recordings.getDownloadUrl(recording.id)
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

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
      toast.success('Download started')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return
    batchDeleteMutation.mutate(Array.from(selectedIds))
  }

  const columns = useMemo(() => [
    {
      id: 'username',
      name: 'User',
      selector: (row: Recording) => row.username,
      sortable: true,
      cell: (row: Recording) => (
        <div>
          <p className="font-medium">@{row.username}</p>
          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
            {row.filename}
          </p>
        </div>
      ),
      minWidth: '200px',
    },
    {
      id: 'status',
      name: 'Status',
      selector: (row: Recording) => row.status,
      sortable: true,
      cell: (row: Recording) => (
        <Badge variant={statusVariantMap[row.status] || 'default'}>
          {row.status}
        </Badge>
      ),
      width: '120px',
    },
    {
      id: 'transcript_status',
      name: 'Transcript',
      selector: (row: Recording) => row.transcript_status || '',
      sortable: true,
      cell: (row: Recording) => (
        row.transcript_status === 'done' ? (
          <Badge variant="success" className="text-xs">Done</Badge>
        ) : row.transcript_status === 'processing' ? (
          <Badge variant="warning" className="text-xs">Processing</Badge>
        ) : row.transcript_status === 'pending' ? (
          <Badge variant="secondary" className="text-xs">Pending</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )
      ),
      width: '130px',
    },
    {
      id: 'duration',
      name: 'Duration',
      selector: (row: Recording) => row.duration_seconds || 0,
      sortable: true,
      cell: (row: Recording) => formatDuration(row.duration_seconds),
      width: '110px',
    },
    {
      id: 'size',
      name: 'Size',
      selector: (row: Recording) => row.file_size || 0,
      sortable: true,
      cell: (row: Recording) => formatBytes(row.file_size),
      width: '100px',
    },
    {
      id: 'date',
      name: 'Date',
      selector: (row: Recording) => row.started_at || row.created_at || '',
      sortable: true,
      cell: (row: Recording) => <span className="text-sm text-muted-foreground">{fmt(row.started_at || row.created_at)}</span>,
      width: '160px',
    },
    {
      name: 'Actions',
      cell: (row: Recording) => (
        <div className="inline-flex -space-x-px rounded-lg shadow-sm">
          {row.status === 'recording' && (
            <button
              className="inline-flex items-center justify-center p-2 text-sm font-medium focus:z-10 focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer first:rounded-s-lg last:rounded-e-lg bg-red-600 text-white hover:bg-red-700"
              onClick={() => stopRecordingMutation.mutate(row.id)}
              disabled={stopRecordingMutation.isPending}
              aria-label="Stop recording"
            >
              <StopCircle className="h-4 w-4" />
            </button>
          )}
          {(row.status === 'completed' || row.status === 'stopped') && (
            <button
              className="inline-flex items-center justify-center p-2 text-sm font-medium focus:z-10 focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer first:rounded-s-lg last:rounded-e-lg bg-primary text-white hover:bg-primary-hover"
              onClick={() => handleDownload(row)}
              aria-label="Download recording"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          <button
            className="inline-flex items-center justify-center p-2 text-sm font-medium focus:z-10 focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer first:rounded-s-lg last:rounded-e-lg bg-red-600 text-white hover:bg-red-700"
            onClick={() => deleteRecordingMutation.mutate(row.id)}
            disabled={deleteRecordingMutation.isPending}
            aria-label="Delete recording"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
      width: '140px',
      right: true,
    },
  ], [fmt, stopRecordingMutation.isPending, deleteRecordingMutation.isPending])

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
              <Play className="h-4 w-4" />
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
          </div>
        </CardHeader>
        <CardBody>
          {selectedIds.size > 0 && recordings.length > 0 && (
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
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download ZIP
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          )}

          <DataTable
            columns={columns}
            data={recordings}
            selectableRows
            selectableRowsHighlight
            onSelectedRowsChange={({ selectedRows }) => {
              setSelectedIds(new Set(selectedRows.map((r: Recording) => r.id)))
            }}
            customStyles={customStyles}
            progressPending={isLoading}
            progressComponent={<div className="py-8 text-center text-muted-foreground">Loading...</div>}
            noDataComponent={
              <EmptyState
                icon={Video}
                title="No recordings found"
                description="Start a recording to capture TikTok live streams"
                actionLabel="Start your first recording"
                onAction={() => setRecordDialogOpen(true)}
              />
            }
            pagination
            paginationServer
            paginationTotalRows={total}
            paginationPerPage={perPage}
            paginationRowsPerPageOptions={[10, 20, 50, 100]}
            onChangePage={(p) => setPage(p)}
            onChangeRowsPerPage={(n) => { setPerPage(n); setPage(1) }}
            sortServer
            onSort={(column) => {
              const field = (column as any).id || 'date'
              setSortBy(field)
              setSortOrder((prev) => prev === 'asc' ? 'desc' : 'asc')
              setPage(1)
            }}
            striped
            resizable
            highlightOnHover
            pointerOnHover
            subHeader={
              <div className="flex items-center gap-2 w-full">
                <select
                  value={statusFilter || 'all'}
                  onChange={(e) => { const val = e.target.value; setStatusFilter(val === 'all' ? undefined : val); setPage(1) }}
                  className="h-8 px-2 text-sm rounded-lg border bg-background text-foreground border-border focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All Status</option>
                  <option value="recording">Recording</option>
                  <option value="completed">Completed</option>
                  <option value="stopped">Stopped</option>
                  <option value="failed">Failed</option>
                </select>
                <input
                  placeholder="Filter by user…"
                  value={usernameFilter}
                  onChange={(e) => { setUsernameFilter(e.target.value); setPage(1) }}
                  className="h-8 px-3 text-sm rounded-lg border bg-background text-foreground border-border focus:outline-none focus:ring-2 focus:ring-primary w-48"
                />
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            }
          />
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
