import { useState, useMemo, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  RefreshCw,
  Trash2,
  Play,
  Radio,
  Eye,
  EyeOff,
  Search,
  Users,
  ExternalLink,
  Film,
  Loader2,
  Ban,
  Upload,
  ClipboardList,
  Check,
  X,
} from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle } from 'components/selia/card'
import { Button } from 'components/selia/button'
import { Badge } from 'components/selia/badge'
import { Input } from 'components/selia/input'
import { Label } from 'components/selia/label'
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from 'components/selia/dialog'
import {
  Drawer,
  DrawerTrigger,
  DrawerPopup,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerClose,
} from 'components/selia/drawer'
import DataTable from 'react-data-table-component'
import { api, type User, type Recording } from '@/lib/api'
import { useDateFormat } from '@/lib/timezone-context'
import toast from 'react-hot-toast'
import EmptyState from '@/components/EmptyState'

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
    },
    stripedStyle: {
      backgroundColor: 'var(--table-accent)',
    },
    highlightOnHoverStyle: {
      backgroundColor: 'var(--table-head)',
      transitionDuration: '150ms',
      transitionProperty: 'background-color',
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

export default function Watchlist() {
  const fmt = useDateFormat()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [newUsername, setNewUsername] = useState('')
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [detailUserId, setDetailUserId] = useState<number | null>(null)
  const queryClient = useQueryClient()
  const retriedIdsRef = useRef<Set<number>>(new Set())

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.users.list(),
  })

  const { data: detailUser } = useQuery({
    queryKey: ['user', detailUserId],
    queryFn: () => api.users.get(detailUserId!),
    enabled: detailUserId !== null,
  })

  const { data: userRecordings } = useQuery({
    queryKey: ['recordings', 'user', detailUserId],
    queryFn: () => api.recordings.list(1, 20, undefined, detailUserId!),
    enabled: detailUserId !== null,
  })

  const addUserMutation = useMutation({
    mutationFn: (data: { username: string; isMonitoring: boolean }) =>
      api.users.create(data.username, data.isMonitoring),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setAddDialogOpen(false)
      setNewUsername('')
      setIsMonitoring(false)
      toast.success('User added')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const removeFromWatchlistMutation = useMutation({
    mutationFn: (id: number) => api.users.removeFromWatchlist(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setSelectedIds(new Set())
      toast.success('User removed')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const refreshUserMutation = useMutation({
    mutationFn: (id: number) => api.users.refresh(id, true),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['user', id] })
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const toggleMonitoringMutation = useMutation({
    mutationFn: ({ id, isMonitoring }: { id: number; isMonitoring: boolean }) =>
      api.users.update(id, { is_monitoring: isMonitoring }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const startRecordingMutation = useMutation({
    mutationFn: (username: string) => api.recordings.start({ username }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['activeRecordings'] })
      toast.success('Recording started')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const batchToggleMonitoring = useMutation({
    mutationFn: ({ ids, monitoring }: { ids: number[]; monitoring: boolean }) =>
      Promise.all(ids.map((id) => api.users.update(id, { is_monitoring: monitoring }))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setSelectedIds(new Set())
      toast.success('Monitoring settings updated')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const columns = useMemo(() => [
    {
      name: 'User',
      selector: (row: User) => row.username,
      sortable: true,
      cell: (row: User) => (
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary-subtle flex items-center justify-center overflow-hidden">
            <img
              src={api.users.getAvatarUrl(row.id)}
              alt={row.username}
              className="h-full w-full object-cover"
              onError={(e) => {
                const img = e.target as HTMLImageElement
                img.style.display = 'none'
                const fallback = img.nextElementSibling as HTMLElement
                if (fallback) fallback.style.display = 'flex'
                if (!retriedIdsRef.current.has(row.id)) {
                  retriedIdsRef.current.add(row.id)
                  api.users.refresh(row.id, true)
                }
              }}
            />
            <span className="text-sm font-medium text-primary hidden items-center justify-center h-full w-full">
              {row.username[0].toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            {row.display_name && <p className="font-medium text-sm leading-tight">{row.display_name}</p>}
            <p className={row.display_name ? 'text-xs text-muted-foreground' : 'font-medium text-sm'}>
              @{row.username}
            </p>
          </div>
        </div>
      ),
      minWidth: '240px',
    },
    {
      name: 'Status',
      selector: (row: User) => (row.is_live ? 'Live' : 'Offline'),
      sortable: true,
      cell: (row: User) => (
        row.is_live ? (
          <Badge variant="danger" className="gap-1">
            <Radio className="h-3 w-3" />
            LIVE
          </Badge>
        ) : (
          <Badge variant="secondary">Offline</Badge>
        )
      ),
      width: '120px',
    },
    {
      name: 'Monitoring',
      selector: (row: User) => (row.is_monitoring ? 'On' : 'Off'),
      sortable: true,
      cell: (row: User) => (
        <Button
          variant="plain"
          size="sm"
          onClick={() => toggleMonitoringMutation.mutate({ id: row.id, isMonitoring: !row.is_monitoring })}
        >
          {row.is_monitoring ? (
            <>
              <Eye className="h-4 w-4 mr-1 text-success" />
              <span className="text-success">On</span>
            </>
          ) : (
            <>
              <EyeOff className="h-4 w-4 mr-1 text-muted-foreground" />
              <span className="text-muted-foreground">Off</span>
            </>
          )}
        </Button>
      ),
      width: '140px',
    },
    {
      name: 'Last Checked',
      selector: (row: User) => row.last_checked || '',
      sortable: true,
      cell: (row: User) => <span className="text-muted-foreground text-sm">{fmt(row.last_checked)}</span>,
      width: '160px',
    },
    {
      name: 'Actions',
      cell: (row: User) => (
        <div className="inline-flex -space-x-px rounded-lg shadow-sm">
          <button
            className="inline-flex items-center justify-center p-2 text-sm font-medium focus:z-10 focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer first:rounded-s-lg last:rounded-e-lg bg-gray-500 text-white hover:bg-gray-600"
            onClick={() => refreshUserMutation.mutate(row.id)}
            disabled={refreshUserMutation.isPending}
            aria-label="Refresh user"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {row.is_live && (
            <button
              className="inline-flex items-center justify-center p-2 text-sm font-medium focus:z-10 focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer first:rounded-s-lg last:rounded-e-lg bg-primary text-white hover:bg-primary-hover"
              onClick={() => startRecordingMutation.mutate(row.username)}
              disabled={startRecordingMutation.isPending}
              aria-label="Start recording"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            className="inline-flex items-center justify-center p-2 text-sm font-medium focus:z-10 focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer first:rounded-s-lg last:rounded-e-lg bg-red-600 text-white hover:bg-red-700"
            onClick={() => removeFromWatchlistMutation.mutate(row.id)}
            disabled={removeFromWatchlistMutation.isPending}
            aria-label="Remove user"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
      width: '140px',
      right: true,
    },
  ], [fmt, refreshUserMutation.isPending, startRecordingMutation.isPending, removeFromWatchlistMutation.isPending])

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault()
    if (newUsername.trim()) {
      addUserMutation.mutate({ username: newUsername.trim(), isMonitoring })
    }
  }

  const handleRefreshAll = async () => {
    for (const user of users) {
      await refreshUserMutation.mutateAsync(user.id)
    }
      toast.success('All user statuses updated')
  }

  const filteredUsers = useMemo(() => {
    let sorted = [...users].sort((a, b) => {
      if (a.is_live === b.is_live) return 0
      return a.is_live ? -1 : 1
    })
    if (!searchQuery.trim()) return sorted
    const q = searchQuery.toLowerCase()
    return sorted.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.display_name && u.display_name.toLowerCase().includes(q))
    )
  }, [users, searchQuery])

  const selectedCount = selectedIds.size

  // Export: copy @username list to clipboard
  const handleExport = useCallback(() => {
    const list = users.map((u) => `@${u.username}`).join('\n')
    // Use textarea fallback for insecure contexts (Docker/nginx)
    const textarea = document.createElement('textarea')
    textarea.value = list
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      toast('Exported', { description: 'Usernames copied to clipboard' })
    } catch {
      toast.error('Export failed', { description: 'Could not copy to clipboard' })
    }
    document.body.removeChild(textarea)
  }, [users, toast])

  // Import: parse @username list and add users
  const handleImport = useCallback(() => {
    if (!importText.trim()) return
    setImportStatus(null)
    const usernames = importText
      .split('\n')
      .map((line) => line.trim().replace(/^@/, '').replace(/\s.*$/, ''))
      .filter(Boolean)
    if (usernames.length === 0) {
      setImportStatus('No valid usernames found')
      return
    }
    let completed = 0
    let failed = 0
    const run = async () => {
      for (const username of usernames) {
        try {
          await api.users.create(username, true)
          completed++
        } catch {
          failed++
        }
      }
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setImportDialogOpen(false)
      setImportText('')
      setImportStatus(null)
      if (failed === 0) {
        toast('Import complete', { description: `Added ${completed} user(s) to your watchlist` })
      } else {
        toast(`Import complete`, { description: `Added ${completed} user(s), ${failed} failed` })
      }
    }
    run()
  }, [importText, queryClient])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Watchlist</h1>
          <p className="text-muted-foreground mt-1">
            Manage TikTok users you want to monitor and record
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger>
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
            </DialogTrigger>
            <DialogPopup>
              <DialogHeader>
                <DialogTitle>Import Users</DialogTitle>
                <DialogDescription>
                  Paste a list of @usernames, one per line, to add them to your watchlist with monitoring enabled.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <textarea
                  className="w-full min-h-[160px] rounded-lg border border-input bg-background p-3 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={`@user1\n@user2\n@user3`}
                  value={importText}
                  onChange={(e) => { setImportText(e.target.value); setImportStatus(null) }}
                />
                {importStatus && (
                  <div className={`mt-2 text-sm flex items-center gap-1.5 ${importStatus.includes('failed') ? 'text-danger' : 'text-success'}`}>
                    {importStatus.includes('failed') ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    {importStatus}
                  </div>
                )}
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setImportDialogOpen(false); setImportText(''); setImportStatus(null) }}>
                  Cancel
                </Button>
                <Button onClick={handleImport} disabled={!importText.trim()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Import {importText.trim() ? `(${importText.split('\n').filter(Boolean).length})` : ''}
                </Button>
              </DialogFooter>
            </DialogPopup>
          </Dialog>
          <Button variant="outline" onClick={handleExport} disabled={users.length === 0}>
            <ClipboardList className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" onClick={handleRefreshAll} disabled={users.length === 0}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh All
          </Button>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogPopup>
              <form onSubmit={handleAddUser}>
                <DialogHeader>
                  <DialogTitle>Add User to Watchlist</DialogTitle>
                  <DialogDescription>
                    Enter a TikTok username to add to your watchlist
                  </DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="username">Username</Label>
                      <Input
                        id="username"
                        placeholder="@username or username"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="monitoring"
                        checked={isMonitoring}
                        onChange={(e) => setIsMonitoring(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <Label htmlFor="monitoring" className="text-sm font-normal">
                        Enable automatic monitoring
                      </Label>
                    </div>
                  </div>
                </DialogBody>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={addUserMutation.isPending}>
                    {addUserMutation.isPending ? 'Adding...' : 'Add User'}
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
            <CardTitle>Users ({filteredUsers.length})</CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 w-full sm:w-64"
              />
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {selectedCount > 0 && (
            <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-muted/40">
              <span className="text-sm font-medium mr-2">{selectedCount} selected</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  batchToggleMonitoring.mutate({
                    ids: Array.from(selectedIds),
                    monitoring: true,
                  })
                }
              >
                <Eye className="h-3 w-3 mr-1" />
                Enable Monitoring
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  batchToggleMonitoring.mutate({
                    ids: Array.from(selectedIds),
                    monitoring: false,
                  })
                }
              >
                <EyeOff className="h-3 w-3 mr-1" />
                Disable Monitoring
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  Array.from(selectedIds).forEach((id) =>
                    removeFromWatchlistMutation.mutate(id)
                  )
                }}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Remove
              </Button>
              <Button
                size="sm"
                variant="plain"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          )}

          <DataTable
                columns={columns}
                data={filteredUsers}
                selectableRows
                selectableRowsHighlight
                onSelectedRowsChange={({ selectedRows }) => {
                  setSelectedIds(new Set(selectedRows.map((r: User) => r.id)))
                }}
                pagination
                paginationPerPage={20}
                paginationRowsPerPageOptions={[10, 20, 50, 100]}
                customStyles={customStyles}
                onRowClicked={(row: User) => setDetailUserId(row.id)}
                highlightOnHover
                pointerOnHover
                striped
                resizable
                progressPending={isLoading}
                progressComponent={<div className="py-8 text-center text-muted-foreground">Loading...</div>}
                noDataComponent={
                  <EmptyState
                    icon={Users}
                    title={searchQuery ? 'No users match your search' : 'No users in your watchlist'}
                    description={searchQuery ? 'Try a different search term' : 'Add TikTok users to start monitoring their livestreams'}
                    actionLabel={searchQuery ? undefined : 'Add your first user'}
                    onAction={searchQuery ? undefined : () => setAddDialogOpen(true)}
                  />
                }
              />
        </CardBody>
      </Card>

      {/* User Detail Drawer */}
      <Drawer open={detailUserId !== null} onOpenChange={(open) => { if (!open) setDetailUserId(null) }}>
        <DrawerPopup direction="right" className="overflow-y-auto">
          <DrawerHeader>
            <DrawerTitle>
              {detailUser ? `@${detailUser.username}` : 'User Details'}
            </DrawerTitle>
            <DrawerDescription>
              {detailUser?.display_name || ''}
            </DrawerDescription>
          </DrawerHeader>

          <DrawerBody>
          {detailUser ? (
            <div className="mt-6 space-y-6">
              {/* Avatar */}
              <div className="flex justify-center">
                <div className="h-24 w-24 rounded-full bg-primary-subtle overflow-hidden">
                  <img
                    src={api.users.getAvatarUrl(detailUser.id)}
                    alt={detailUser.username}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement
                      img.style.display = 'none'
                      const fallback = img.nextElementSibling as HTMLElement
                      if (fallback) fallback.style.display = 'flex'
                      if (!retriedIdsRef.current.has(detailUser.id)) {
                        retriedIdsRef.current.add(detailUser.id)
                        api.users.refresh(detailUser.id, true)
                      }
                    }}
                  />
                  <span className="hidden h-full w-full items-center justify-center text-2xl font-medium text-primary fallback-initial">
                    {detailUser.username[0].toUpperCase()}
                  </span>
                </div>
              </div>

              {/* User info */}
              <div className="space-y-3">
                <div className="text-center">
                  {detailUser.display_name && (
                    <p className="font-semibold text-lg">{detailUser.display_name}</p>
                  )}
                  <p className="text-muted-foreground">@{detailUser.username}</p>
                </div>

                {detailUser.bio && (
                  <p className="text-sm text-center text-muted-foreground">{detailUser.bio}</p>
                )}

                <div className="flex justify-center gap-4 text-sm">
                  <div className="text-center">
                    <p className="font-semibold">{detailUser.follower_count?.toLocaleString() || 'N/A'}</p>
                    <p className="text-muted-foreground text-xs">Followers</p>
                  </div>
                  <div className="text-center">
                    <p className="font-semibold">{detailUser.is_live ? 'Live' : 'Offline'}</p>
                    <p className="text-muted-foreground text-xs">Status</p>
                  </div>
                </div>
              </div>

              {/* Quick actions */}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    window.open(`https://www.tiktok.com/@${detailUser.username}`, '_blank')
                  }}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  TikTok Profile
                </Button>
                {detailUser.is_live && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    onClick={() => startRecordingMutation.mutate(detailUser.username)}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Record Now
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() =>
                    toggleMonitoringMutation.mutate({
                      id: detailUser.id,
                      isMonitoring: !detailUser.is_monitoring,
                    })
                  }
                >
                  {detailUser.is_monitoring ? (
                    <><Ban className="h-3 w-3 mr-1" /> Stop Monitoring</>
                  ) : (
                    <><Eye className="h-3 w-3 mr-1" /> Monitor</>
                  )}
                </Button>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => refreshUserMutation.mutate(detailUser.id)}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  className="flex-1"
                  onClick={() => {
                    removeFromWatchlistMutation.mutate(detailUser.id)
                    setDetailUserId(null)
                  }}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Remove
                </Button>
              </div>

              {/* Recent Recordings */}
              <div>
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Film className="h-4 w-4" />
                  Recent Recordings
                </h4>
                {!userRecordings ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : userRecordings.recordings.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No recordings for this user yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {userRecordings.recordings.slice(0, 10).map((rec: Recording) => (
                      <div
                        key={rec.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40 cursor-pointer transition-colors"
                        onClick={() => {
                          window.open(`/watch/${rec.id}`, '_blank')
                        }}
                      >
                        <div className="h-10 w-14 rounded bg-muted overflow-hidden shrink-0 relative">
                          {rec.thumbnail_ready ? (
                            <>
                              <img
                                src={api.recordings.getThumbnailUrl(rec.id)}
                                alt=""
                                className="h-full w-full object-cover"
                                onError={(e) => {
                                  const img = e.target as HTMLImageElement
                                  img.style.display = 'none'
                                  const fallback = img.nextElementSibling as HTMLElement
                                  if (fallback) fallback.classList.remove('hidden')
                                }}
                              />
                              <div className="hidden h-full w-full flex items-center justify-center absolute inset-0">
                                <Film className="h-3 w-3 text-muted-foreground" />
                              </div>
                            </>
                          ) : (
                            <div className="h-full w-full flex items-center justify-center">
                              <Film className="h-3 w-3 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">
                            {rec.filename || `Recording #${rec.id}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {fmt(rec.ended_at || rec.created_at)}
                          </p>
                        </div>
                        <Badge variant="secondary-outline" className="text-[10px] capitalize">
                          {rec.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </DrawerBody>
        </DrawerPopup>
      </Drawer>
    </div>
  )
}
