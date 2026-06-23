import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Database,
  HardDrive,
  Trash2,
  Archive,
  Loader2,
  ArrowLeft,
  User,
  Video,
  Crown,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/selia/button'
import { IconBox } from '@/components/selia/icon-box'
import { StaggerContainer, StaggerItem } from '@/components/motion'
import { api, type StorageStats } from '@/lib/api'
import { formatBytes, formatDuration, cn } from '@/lib/utils'
import toast from 'react-hot-toast'

export default function Storage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['statsOverview'],
    queryFn: () => api.stats.overview(),
  })

  const { data: storageStats, isLoading: statsLoading } = useQuery<StorageStats>({
    queryKey: ['storageStats'],
    queryFn: () => api.stats.storage(),
  })

  const { data: byUser, isLoading: byUserLoading } = useQuery({
    queryKey: ['storageByUser'],
    queryFn: () => api.stats.storageByUser(50),
  })

  const { data: largest, isLoading: largestLoading } = useQuery({
    queryKey: ['largestRecordings'],
    queryFn: () => api.stats.largestRecordings(25),
  })

  const compressMutation = useMutation({
    mutationFn: (ids: number[]) => api.recordings.batchCompress(ids),
    onSuccess: (res) => {
      toast.success(`Compressed ${res.compressed} recordings`)
      invalidateAll()
      setSelected(new Set())
    },
    onError: (e: Error) => toast.error(e.message || 'Compress failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.recordings.batchDelete(ids),
    onSuccess: (res) => {
      toast.success(`Deleted ${res.deleted} recordings`)
      invalidateAll()
      setSelected(new Set())
    },
    onError: (e: Error) => toast.error(e.message || 'Delete failed'),
  })

  const cleanupMutation = useMutation({
    mutationFn: () => api.settings.runCleanup(),
    onSuccess: (res) => {
      toast.success(`Cleanup complete: ${res.deleted} deleted, ${res.compressed} compressed`)
      invalidateAll()
    },
    onError: (e: Error) => toast.error(e.message || 'Cleanup failed'),
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['statsOverview'] })
    queryClient.invalidateQueries({ queryKey: ['storageStats'] })
    queryClient.invalidateQueries({ queryKey: ['storageByUser'] })
    queryClient.invalidateQueries({ queryKey: ['largestRecordings'] })
    queryClient.invalidateQueries({ queryKey: ['recordings'] })
  }

  const toggleSelect = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const total = storageStats?.total_storage ?? overview?.total_storage ?? 0
  const recordingBytes = storageStats?.recording_storage ?? 0
  const clipBytes = storageStats?.clip_storage ?? overview?.clip_storage ?? 0

  const isLoading = overviewLoading || statsLoading || byUserLoading || largestLoading
  const loadingRows = 6

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Button
              variant="plain"
              size="sm"
              onClick={() => navigate(-1)}
              className="h-8 px-2 -ml-2"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <IconBox variant="secondary-subtle" size="sm">
              <Database className="h-3.5 w-3.5" />
            </IconBox>
            <span className="text-sm font-medium">Storage</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Storage Management</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => cleanupMutation.mutate()}
            disabled={cleanupMutation.isPending}
          >
            {cleanupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Archive className="h-4 w-4 mr-1.5" />}
            Run Cleanup
          </Button>
        </div>
      </div>

      {/* Headline stats */}
        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StaggerItem>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary-subtle flex items-center justify-center">
                  <HardDrive className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{formatBytes(total)}</p>
                  <p className="text-xs text-muted-foreground">Total used</p>
                </div>
              </div>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Video className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{formatBytes(recordingBytes)}</p>
                  <p className="text-xs text-muted-foreground">Recordings</p>
                </div>
              </div>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Crown className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{formatBytes(clipBytes)}</p>
                  <p className="text-xs text-muted-foreground">Clips</p>
                </div>
              </div>
            </div>
          </StaggerItem>
          <StaggerItem>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <Archive className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{formatBytes(storageStats?.backup_storage ?? 0)}</p>
                  <p className="text-xs text-muted-foreground">Backups</p>
                </div>
              </div>
            </div>
          </StaggerItem>
        </StaggerContainer>

        {/* Per-user breakdown */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Storage by User</h2>
            <p className="text-xs text-muted-foreground">Top users by disk usage</p>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: loadingRows }).map((_, i) => (
                  <div key={i} className="h-12 rounded-lg bg-muted/60 animate-pulse" />
                ))}
              </div>
            ) : (byUser?.length ?? 0) === 0 ? (
              <div className="p-10 text-center">
                <User className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No user data yet</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium text-right">Recordings</th>
                    <th className="px-4 py-2 font-medium text-right">Storage</th>
                    <th className="px-4 py-2 font-medium text-right">% of total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byUser?.map((u) => (
                    <tr key={u.user_id} className="hover:bg-accent/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">
                        <span className="inline-flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          {u.username}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.count}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatBytes(u.bytes)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {total > 0 ? `${((u.bytes / total) * 100).toFixed(1)}%` : '0%'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Largest recordings with bulk actions */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">Largest Recordings</h2>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => compressMutation.mutate(Array.from(selected))}
                    disabled={compressMutation.isPending || deleteMutation.isPending}
                  >
                    <Archive className="h-4 w-4 mr-1.5" />
                    Compress {selected.size}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => deleteMutation.mutate(Array.from(selected))}
                    disabled={compressMutation.isPending || deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Delete {selected.size}
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {largestLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: loadingRows }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted/60 animate-pulse" />
                ))}
              </div>
            ) : (largest?.length ?? 0) === 0 ? (
              <div className="p-10 text-center">
                <Video className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No recordings to manage</p>
              </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-4 py-2 w-10">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="px-4 py-2 font-medium">Recording</th>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium text-right">Size</th>
                    <th className="px-4 py-2 font-medium text-right">Duration</th>
                    <th className="px-4 py-2 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {largest?.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/40 transition-colors">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(`/watch/${r.id}`)}
                          className="text-left font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {r.filename}
                        </button>
                        <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.username}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatBytes(r.file_size)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {r.duration_seconds ? formatDuration(r.duration_seconds) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          r.status === 'completed' && 'bg-success/10 text-success',
                          r.status === 'recording' && 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300',
                          r.status === 'compressed' && 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300',
                          !['completed', 'recording', 'compressed'].includes(r.status) && 'bg-muted text-muted-foreground'
                        )}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Info note */}
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            Compress moves original recordings to a backup archive and replaces them with smaller remuxed versions. Deleted recordings are removed permanently.
          </p>
        </div>
    </div>
  )
}
