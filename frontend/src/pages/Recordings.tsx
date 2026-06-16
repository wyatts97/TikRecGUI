import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  Trash2,
  StopCircle,
  Play,
  Video,
  Loader2,
  ChevronLeft,
  ChevronRight,
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
import EmptyState from '@/components/EmptyState'
import { api, type Recording } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/utils'
import { useDateFormat } from '@/lib/timezone-context'
import toast from 'react-hot-toast'

const PER_PAGE = 20

const statusVariantMap: Record<string, 'secondary' | 'info' | 'success' | 'danger' | 'secondary-outline'> = {
  pending: 'secondary',
  recording: 'info',
  completed: 'success',
  failed: 'danger',
  stopped: 'secondary-outline',
}


export default function Recordings() {
  const fmt = useDateFormat()
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(() => {
    const p = searchParams.get('page')
    return p ? parseInt(p) : 1
  })
  const perPage = (() => {
    const pp = searchParams.get('perPage')
    return pp ? parseInt(pp) : 20
  })()
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
  const [tablePage, setTablePage] = useState(1)
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

  const stopAllMutation = useMutation({
    mutationFn: () => api.recordings.stopAll(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
      toast.success(`${data.stopped} recording(s) stopped`)
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


  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Recordings</h1>
          <p className="text-muted-foreground mt-1">
            View and manage your TikTok live recordings
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="danger"
            onClick={() => stopAllMutation.mutate()}
            disabled={stopAllMutation.isPending}
          >
            {stopAllMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <StopCircle className="h-4 w-4 mr-2" />
            )}
            Stop Recording All
          </Button>
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
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Recordings ({total})
            </CardTitle>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter || 'all'}
                onChange={(e) => { const val = e.target.value; setStatusFilter(val === 'all' ? undefined : val); setPage(1); setTablePage(1) }}
                className="h-8 px-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-800 dark:bg-neutral-900 dark:border-neutral-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                onChange={(e) => { setUsernameFilter(e.target.value); setPage(1); setTablePage(1) }}
                className="h-8 px-3 text-sm rounded-lg border border-gray-200 bg-white text-gray-800 dark:bg-neutral-900 dark:border-neutral-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
              />
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="h-8 px-2 text-xs text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
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

          {isLoading ? (
            <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /></div>
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
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-neutral-700">
                  <thead className="bg-gray-50 dark:bg-neutral-800">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-start">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 dark:border-neutral-600"
                          checked={selectedIds.size === recordings.length && recordings.length > 0}
                          onChange={(e) => setSelectedIds(e.target.checked ? new Set(recordings.map((r) => r.id)) : new Set())}
                        />
                      </th>
                      <th scope="col" className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-neutral-400">User</th>
                      <th scope="col" className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-neutral-400">Status</th>
                      <th scope="col" className="hidden sm:table-cell px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-neutral-400">Transcript</th>
                      <th scope="col" className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-neutral-400">Duration</th>
                      <th scope="col" className="hidden sm:table-cell px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-neutral-400">Size</th>
                      <th scope="col" className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-neutral-400">Date</th>
                      <th scope="col" className="px-4 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-neutral-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-neutral-700">
                    {recordings.slice((tablePage - 1) * PER_PAGE, tablePage * PER_PAGE).map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 dark:border-neutral-600"
                            checked={selectedIds.has(row.id)}
                            onChange={(e) => {
                              const next = new Set(selectedIds)
                              e.target.checked ? next.add(row.id) : next.delete(row.id)
                              setSelectedIds(next)
                            }}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className="block text-sm font-semibold text-gray-800 dark:text-neutral-200">@{row.username}</span>
                          <span className="block text-xs text-gray-500 dark:text-neutral-400 truncate max-w-[200px]">{row.filename}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariantMap[row.status] || 'secondary'}>{row.status}</Badge>
                        </td>
                        <td className="hidden sm:table-cell px-4 py-3">
                          {row.transcript_status === 'done' ? (
                            <Badge variant="success" className="text-xs">Done</Badge>
                          ) : row.transcript_status === 'processing' ? (
                            <Badge variant="warning" className="text-xs">Processing</Badge>
                          ) : row.transcript_status === 'pending' ? (
                            <Badge variant="secondary" className="text-xs">Pending</Badge>
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-neutral-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600 dark:text-neutral-300">{formatDuration(row.duration_seconds)}</span>
                        </td>
                        <td className="hidden sm:table-cell px-4 py-3">
                          <span className="text-sm text-gray-600 dark:text-neutral-300">{formatBytes(row.file_size)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-500 dark:text-neutral-400">{fmt(row.started_at || row.created_at)}</span>
                        </td>
                        <td className="px-4 py-3 text-end">
                          <div className="inline-flex rounded-lg shadow-sm">
                            {row.status === 'recording' && (
                              <button
                                title="Stop recording"
                                className="py-1.5 px-2 inline-flex items-center -ms-px first:rounded-s-lg first:ms-0 last:rounded-e-lg text-sm font-medium focus:z-10 border border-gray-200 bg-white text-red-500 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-neutral-900 dark:border-neutral-700 dark:text-red-400 dark:hover:bg-neutral-800 transition-colors"
                                onClick={() => stopRecordingMutation.mutate(row.id)}
                                disabled={stopRecordingMutation.isPending}
                              >
                                <StopCircle className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {(row.status === 'completed' || row.status === 'stopped') && (
                              <button
                                title="Download"
                                className="py-1.5 px-2 inline-flex items-center -ms-px first:rounded-s-lg first:ms-0 last:rounded-e-lg text-sm font-medium focus:z-10 border border-gray-200 bg-white text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-neutral-900 dark:border-neutral-700 dark:text-blue-400 dark:hover:bg-neutral-800 transition-colors"
                                onClick={() => handleDownload(row)}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              title="Delete"
                              className="py-1.5 px-2 inline-flex items-center -ms-px first:rounded-s-lg first:ms-0 last:rounded-e-lg text-sm font-medium focus:z-10 border border-gray-200 bg-white text-red-500 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-neutral-900 dark:border-neutral-700 dark:text-red-400 dark:hover:bg-neutral-800 transition-colors"
                              onClick={() => deleteRecordingMutation.mutate(row.id)}
                              disabled={deleteRecordingMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {recordings.length > PER_PAGE && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-neutral-700">
                  <span className="text-sm text-gray-500 dark:text-neutral-400">
                    {(tablePage - 1) * PER_PAGE + 1}–{Math.min(tablePage * PER_PAGE, recordings.length)} of {total}
                  </span>
                  <div className="inline-flex rounded-lg shadow-sm">
                    <button
                      className="py-1.5 px-2 inline-flex items-center -ms-px first:rounded-s-lg first:ms-0 last:rounded-e-lg text-sm font-medium focus:z-10 border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:bg-neutral-900 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-800"
                      onClick={() => { const prev = tablePage - 1; setTablePage(prev); setPage(prev) }}
                      disabled={tablePage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      className="py-1.5 px-2 inline-flex items-center -ms-px first:rounded-s-lg first:ms-0 last:rounded-e-lg text-sm font-medium focus:z-10 border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:bg-neutral-900 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-800"
                      onClick={() => { const next = tablePage + 1; setTablePage(next); setPage(next) }}
                      disabled={tablePage * PER_PAGE >= total}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
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
