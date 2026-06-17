import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tv, Search } from 'lucide-react'
import { Button } from '@/components/selia/button'
import { Input } from '@/components/selia/input'
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectList, SelectItem } from '@/components/selia/select'
import EmptyState from '@/components/EmptyState'
import { RecordingVideoCard } from '@/components/ui/recording-video-card'
import { api, type Recording } from '@/lib/api'

const ITEMS_PER_PAGE = 12

export default function Watch() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)

  const [repairingId, setRepairingId] = useState<number | null>(null)

  const toggleFavoriteMutation = useMutation({
    mutationFn: (id: number) => api.recordings.toggleFavorite(id),
    onSuccess: (updated: Recording) => {
      queryClient.setQueryData(['recordings', 'watchable'], (old: any) => {
        if (!old) return old
        return {
          ...old,
          recordings: old.recordings.map((r: Recording) =>
            r.id === updated.id ? { ...r, is_favorite: updated.is_favorite } : r
          ),
        }
      })
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
        <span className="text-xs text-muted-foreground">
          {filtered.length} recording{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading recordings...</p>
        </div>
      ) : recordings.length === 0 ? (
        <EmptyState
          icon={Tv}
          title={searchQuery ? 'No matching recordings' : 'No recordings yet'}
          description={searchQuery ? 'Try a different search' : 'Start a recording and come back here when it finishes.'}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {recordings.map((recording) => (
              <RecordingVideoCard
                key={recording.id}
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
                onRepair={(e) => {
                  e.stopPropagation()
                  if (repairingId === recording.id) return
                  handleRepair(recording.id)
                }}
              />
            ))}
          </div>

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
