import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Play, Scissors, Loader2, Search, Heart, Download, Trash2, X, Package, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card } from '@/components/selia/card'
import { Button } from '@/components/selia/button'
import { Checkbox } from '@/components/selia/checkbox'
import { Input } from '@/components/selia/input'
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectList, SelectItem } from '@/components/selia/select'
import { Pagination, PaginationList, PaginationItem, PaginationButton } from '@/components/selia/pagination'
import EmptyState from '@/components/EmptyState'
import QueryError from '@/components/QueryError'
import { VideoGridSkeleton } from '@/components/Skeleton'
import { StaggerContainer, StaggerItem } from '@/components/motion'
import { api, type Clip } from '@/lib/api'
import { cn, formatBytes, formatDuration } from '@/lib/utils'
import { useDateFormat } from '@/lib/timezone-context'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import toast from 'react-hot-toast'

const ITEMS_PER_PAGE = 12

// Frontend sort labels map onto the backend's (sort_by, sort_order) vocabulary.
// "favorites" is handled specially server-side (floats favorites to the top
// without excluding non-favorites), so it needs no sort_order.
const SORT_MAP: Record<string, { sortBy: string; sortOrder?: string }> = {
  newest: { sortBy: 'date', sortOrder: 'desc' },
  oldest: { sortBy: 'date', sortOrder: 'asc' },
  longest: { sortBy: 'duration', sortOrder: 'desc' },
  shortest: { sortBy: 'duration', sortOrder: 'asc' },
  largest: { sortBy: 'size', sortOrder: 'desc' },
  favorites: { sortBy: 'favorites' },
}

function getPageNumbers(page: number, totalPages: number): (number | 'ellipsis')[] {
  const pages: (number | 'ellipsis')[] = []
  const add = (p: number) => pages.push(p)
  const window = 1
  add(1)
  if (page - window > 2) pages.push('ellipsis')
  for (let p = Math.max(2, page - window); p <= Math.min(totalPages - 1, page + window); p++) add(p)
  if (page + window < totalPages - 1) pages.push('ellipsis')
  if (totalPages > 1) add(totalPages)
  return pages
}

export default function Clips() {
  const fmt = useDateFormat()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const debouncedSearch = useDebouncedValue(searchQuery.trim(), 300)

  const queryClient = useQueryClient()

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
    mutationFn: (ids: number[]) => api.clips.batchDelete(ids),
    onSuccess: (res) => {
      toast.success(`${res.deleted} clip${res.deleted !== 1 ? 's' : ''} deleted`)
      clearSelection()
      queryClient.invalidateQueries({ queryKey: ['clips'] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Batch delete failed')
    },
  })

  const handleBatchDownload = async (ids: number[]) => {
    try {
      const blob = await api.clips.batchDownload(ids)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `clips_${new Date().toISOString().slice(0, 10)}.zip`
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
      const blob = await api.clips.downloadAll()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `all_clips_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      toast.success('Download started')
    } catch (err: any) {
      toast.error(err.message || 'Download failed')
    }
  }

  const queryKey = ['clips', page, sortBy, debouncedSearch] as const

  const toggleFavoriteMutation = useMutation({
    mutationFn: (id: number) => api.clips.toggleFavorite(id),
    // Optimistic update: flip the flag instantly, roll back on error.
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData(queryKey)
      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old) return old
        return {
          ...old,
          clips: old.clips.map((c: Clip) =>
            c.id === id ? { ...c, is_favorite: !c.is_favorite } : c
          ),
        }
      })
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
      toast.error('Failed to update favorite')
    },
  })

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      api.clips.list(page, ITEMS_PER_PAGE, SORT_MAP[sortBy]?.sortBy, SORT_MAP[sortBy]?.sortOrder, undefined, {
        search: debouncedSearch || undefined,
      }),
    placeholderData: keepPreviousData,
  })

  const clips = useMemo(() => data?.clips || [], [data])
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))

  const handleSearch = (val: string) => {
    setSearchQuery(val)
    setPage(1)
  }
  const handleSort = (value: unknown) => {
    const val = String(value)
    setSortBy(val)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground tracking-tight">Clips</h1>
        <p className="text-muted-foreground mt-1">
          Browse and play your extracted clips
        </p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search clips…"
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
          title="Download all clips as ZIP"
        >
          <Package className="h-3.5 w-3.5 mr-1.5" />
          Download All
        </Button>
        <span className="text-xs text-muted-foreground">
          {total} clip{total !== 1 ? 's' : ''}
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

      {isError ? (
        <QueryError error={error} what="clips" onRetry={() => refetch()} />
      ) : isLoading ? (
        <VideoGridSkeleton count={8} />
      ) : clips.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title={searchQuery ? 'No matching clips' : 'No clips yet'}
          description={searchQuery ? 'Try a different search' : 'Create a clip from any recording on the Watch page.'}
        />
      ) : (
        <>
          <StaggerContainer
            className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 transition-opacity ${isFetching ? 'opacity-60' : ''}`}
          >
            {clips.map((clip) => (
              <StaggerItem key={clip.id}>
              <Card
                className="group overflow-hidden cursor-pointer border border-border bg-card hover:shadow-md transition-shadow"
                onClick={() => navigate(`/clips/${clip.id}`)}
              >
                <div className="relative aspect-video bg-muted overflow-hidden">
                  <div
                    className="absolute top-2 left-2 z-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedIds.has(clip.id)}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSelection(clip.id)
                      }}
                      aria-label={`Select clip ${clip.id}`}
                    />
                  </div>
                  {clip.thumbnail_ready ? (
                    <img
                      src={api.clips.getThumbnailUrl(
                        clip.id,
                        clip.file_size ?? clip.created_at,
                      )}
                      alt={`${clip.username} clip thumbnail`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement
                        img.style.display = 'none'
                        const placeholder = img.nextElementSibling as HTMLElement
                        if (placeholder) placeholder.style.display = 'flex'
                      }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/60">
                      <Loader2 className="h-8 w-8 text-muted-foreground animate-spin mb-2" />
                      <span className="text-xs text-muted-foreground font-medium">Processing…</span>
                    </div>
                  )}
                  <div className="absolute inset-0 items-center justify-center bg-muted hidden">
                    <Scissors className="h-12 w-12 text-gray-400" />
                  </div>
                  {clip.thumbnail_ready && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="h-12 w-12 rounded-full bg-background/90 flex items-center justify-center">
                        <Play className="h-5 w-5 text-primary ml-0.5" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {clip.title || `Clip from @${clip.username}`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        @{clip.username} · {fmt(clip.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="plain"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFavoriteMutation.mutate(clip.id)
                        }}
                        title={clip.is_favorite ? 'Unfavorite' : 'Favorite'}
                      >
                        <Heart className={cn('h-4 w-4', clip.is_favorite && 'fill-red-500 text-red-500')} />
                      </Button>
                      <Button
                        variant="plain"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          const a = document.createElement('a')
                          a.href = api.clips.getDownloadUrl(clip.id)
                          a.download = ''
                          document.body.appendChild(a)
                          a.click()
                          document.body.removeChild(a)
                        }}
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{formatDuration(clip.duration_seconds)}</span>
                    <span>·</span>
                    <span>{formatBytes(clip.file_size)}</span>
                  </div>
                </div>
              </Card>
              </StaggerItem>
            ))}
          </StaggerContainer>

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination className="pt-4">
              <PaginationList>
                <PaginationItem>
                  <PaginationButton
                    disabled={page === 1}
                    onClick={() => page > 1 && setPage((p) => p - 1)}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </PaginationButton>
                </PaginationItem>
                {getPageNumbers(page, totalPages).map((p, i) =>
                  p === 'ellipsis' ? (
                    <PaginationItem key={`ellipsis-${i}`}>
                      <span className="px-2 text-sm text-muted-foreground">…</span>
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationButton active={p === page} onClick={() => setPage(p)}>
                        {p}
                      </PaginationButton>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationButton
                    disabled={page === totalPages}
                    onClick={() => page < totalPages && setPage((p) => p + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </PaginationButton>
                </PaginationItem>
              </PaginationList>
            </Pagination>
          )}
        </>
      )}
    </div>
  )
}
