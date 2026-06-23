import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tv, Search, Trash2, Download, X, Package } from 'lucide-react'
import { Button } from '@/components/selia/button'
import { Input } from '@/components/selia/input'
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectList, SelectItem } from '@/components/selia/select'
import EmptyState from '@/components/EmptyState'
import { VideoGridSkeleton } from '@/components/Skeleton'
import { StaggerContainer, StaggerItem } from '@/components/motion'
import { RecordingVideoCard } from '@/components/ui/recording-video-card'
import { api, type Recording } from '@/lib/api'
import toast from 'react-hot-toast'

const ITEMS_PER_PAGE = 12

export default function Watch() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)

  const [repairingId, setRepairingId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api.recordings.batchDelete(ids),
    onSuccess: (res) => {
      toast.success(`${res.deleted} recording${res.deleted !== 1 ? 's' : ''} deleted`)
      clearSelection()
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Batch delete failed')
    },
  })

  const handleBatchDownload = async (ids: number[]) => {
    try {
      const blob = await api.recordings.batchDownload(ids)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recordings_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      toast.success('Download started')
    } catch (err: any) {
      toast.error(err.message || 'Download failed')
    }
  }

  const handleDownloadAll = async () => {
    try {
      const blob = await api.recordings.downloadAll()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `all_recordings_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      toast.success('Download started')
    } catch (err: any) {
      toast.error(err.message || 'Download failed')
    }
  }

  const toggleFavoriteMutation = useMutation({
    mutationFn: (id: number) => api.recordings.toggleFavorite(id),
    // Optimistic update: flip the flag instantly, roll back on error.
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ['recordings', 'watchable'] })
      const previous = queryClient.getQueryData(['recordings', 'watchable'])
      queryClient.setQueryData(['recordings', 'watchable'], (old: any) => {
        if (!old) return old
        return {
          ...old,
          recordings: old.recordings.map((r: Recording) =>
            r.id === id ? { ...r, is_favorite: !r.is_favorite } : r
          ),
        }
      })
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['recordings', 'watchable'], context.previous)
      }
      toast.error('Failed to update favorite')
    },
  })

  const handleRepair = async (id: number) => {
    setRepairingId(id)
    try {
      const updated = await api.recordings.repair(id)
      queryClient.setQueryData(['recordings', 'watchable'], (old: any) => {
        if (!old) return old
        return {
          ...old,
          recordings: old.recordings.map((r: Recording) =>
            r.id === updated.id ? updated : r
          ),
        }
      })
      toast.success('Recording repaired successfully')
    } catch (err: any) {
      toast.error(err.message || 'Repair failed')
    } finally {
      setRepairingId(null)
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ['recordings', 'watchable'],
    queryFn: () => api.recordings.list(1, 200, 'completed,stopped,failed'),
    refetchInterval: (query) => {
      const recs = query.state.data?.recordings ?? []
      return recs.some((r) => !r.thumbnail_ready) ? 5000 : false
    },
  })

  const allRecordings = data?.recordings || []

  const filtered = useMemo(() => {
    let items = [...allRecordings]

    // Filter by username
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      items = items.filter((r) => r.username.toLowerCase().includes(q))
    }

    // Sort
    items.sort((a, b) => {
      switch (sortBy) {
        case 'favorites':
          if (a.is_favorite && !b.is_favorite) return -1
          if (!a.is_favorite && b.is_favorite) return 1
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        case 'newest':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        case 'oldest':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        case 'longest':
          return (b.duration_seconds || 0) - (a.duration_seconds || 0)
        case 'shortest':
          return (a.duration_seconds || 0) - (b.duration_seconds || 0)
        case 'largest':
          return (b.file_size || 0) - (a.file_size || 0)
        default:
          return 0
      }
    })

    return items
  }, [allRecordings, searchQuery, sortBy])

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const recordings = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  // Reset to page 1 when filters change
  const handleSearch = (val: string) => {
    setSearchQuery(val)
    setPage(1)
  }
  const handleSort = (val: string) => {
    setSortBy(val)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground tracking-tight">Watch</h1>
        <p className="text-muted-foreground mt-1">
          Browse and play your completed, stopped, and failed recordings
        </p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by username…"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={sortBy} onValueChange={handleSort}>
          <SelectTrigger className="h-9 w-32 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectList>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="longest">Longest</SelectItem>
              <SelectItem value="shortest">Shortest</SelectItem>
              <SelectItem value="largest">Largest</SelectItem>
              <SelectItem value="favorites">Favorites</SelectItem>
            </SelectList>
          </SelectPopup>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadAll}
          title="Download all recordings as ZIP"
        >
          <Package className="h-3.5 w-3.5 mr-1.5" />
          Download All
        </Button>
        <span className="text-xs text-muted-foreground">
          {filtered.length} recording{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/60 border border-border/50">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBatchDownload(Array.from(selectedIds))}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Download Selected
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => batchDeleteMutation.mutate(Array.from(selectedIds))}
            disabled={batchDeleteMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete Selected
          </Button>
          <Button variant="plain" size="sm" onClick={clearSelection}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {isLoading ? (
        <VideoGridSkeleton count={8} />
      ) : recordings.length === 0 ? (
        <EmptyState
          icon={Tv}
          title={searchQuery ? 'No matching recordings' : 'No recordings yet'}
          description={searchQuery ? 'Try a different search' : 'Start a recording and come back here when it finishes.'}
        />
      ) : (
        <>
          <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {recordings.map((recording) => (
              <StaggerItem key={recording.id}>
              <RecordingVideoCard
                recording={recording}
                onClick={() => navigate(`/watch/${recording.id}`)}
                onFavorite={(e) => {
                  e.stopPropagation()
                  toggleFavoriteMutation.mutate(recording.id)
                }}
                onDownload={(e) => {
                  e.stopPropagation()
                  const a = document.createElement('a')
                  a.href = api.recordings.getDownloadUrl(recording.id)
                  a.download = ''
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                }}
                isRepairing={repairingId === recording.id}
                onRepair={(e) => {
                  e.stopPropagation()
                  if (repairingId === recording.id) return
                  handleRepair(recording.id)
                }}
                selected={selectedIds.has(recording.id)}
                onSelect={(e) => {
                  e.stopPropagation()
                  toggleSelection(recording.id)
                }}
              />
              </StaggerItem>
            ))}
          </StaggerContainer>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
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
    </div>
  )
}
