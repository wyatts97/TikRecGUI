import { useState, useMemo } from 'react'
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
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { api, type User } from '@/lib/api'
import { useDateFormat } from '@/lib/timezone-context'
import { useToast } from '@/components/ui/use-toast'

export default function Watchlist() {
  const fmt = useDateFormat()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.users.list(),
  })

  const addUserMutation = useMutation({
    mutationFn: (data: { username: string; isMonitoring: boolean }) =>
      api.users.create(data.username, data.isMonitoring),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setAddDialogOpen(false)
      setNewUsername('')
      setIsMonitoring(false)
      toast({ title: 'User added', description: 'User has been added to your watchlist' })
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    },
  })

  const deleteUserMutation = useMutation({
    mutationFn: (id: number) => api.users.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'User removed', description: 'User has been removed from your watchlist' })
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    },
  })

  const refreshUserMutation = useMutation({
    mutationFn: (id: number) => api.users.refresh(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
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
      toast({ title: 'Recording started', description: 'Recording has been started' })
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    },
  })

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
    toast({ title: 'Refreshed', description: 'All user statuses have been updated' })
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
          <Button variant="outline" onClick={handleRefreshAll} disabled={users.length === 0}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh All
          </Button>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleAddUser}>
                <DialogHeader>
                  <DialogTitle>Add User to Watchlist</DialogTitle>
                  <DialogDescription>
                    Enter a TikTok username to add to your watchlist
                  </DialogDescription>
                </DialogHeader>
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
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={addUserMutation.isPending}>
                    {addUserMutation.isPending ? 'Adding...' : 'Add User'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
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
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-20 bg-muted animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground mb-4">
                {searchQuery ? 'No users match your search' : 'No users in your watchlist'}
              </p>
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {searchQuery ? 'Add a new user' : 'Add your first user'}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Monitoring</TableHead>
                  <TableHead>Last Checked</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user: User) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary-subtle flex items-center justify-center overflow-hidden">
                          <img
                            src={api.users.getAvatarUrl(user.id)}
                            alt={user.username}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              const img = e.target as HTMLImageElement
                              img.style.display = 'none'
                              const fallback = img.nextElementSibling as HTMLElement
                              if (fallback) fallback.style.display = 'flex'
                            }}
                          />
                          <span className="text-sm font-medium text-primary hidden items-center justify-center h-full w-full">
                            {user.username[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          {user.display_name && (
                            <p className="font-medium text-sm leading-tight">{user.display_name}</p>
                          )}
                          <p className={user.display_name ? "text-xs text-muted-foreground" : "font-medium text-sm"}>
                            @{user.username}
                          </p>
                          {user.bio && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{user.bio}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.is_live ? (
                        <Badge variant="live" className="gap-1">
                          <Radio className="h-3 w-3" />
                          LIVE
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Offline</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          toggleMonitoringMutation.mutate({
                            id: user.id,
                            isMonitoring: !user.is_monitoring,
                          })
                        }
                      >
                        {user.is_monitoring ? (
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
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {fmt(user.last_checked)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => refreshUserMutation.mutate(user.id)}
                          disabled={refreshUserMutation.isPending}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        {user.is_live && (
                          <Button
                            variant="subtle"
                            size="sm"
                            onClick={() => startRecordingMutation.mutate(user.username)}
                            disabled={startRecordingMutation.isPending}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Record
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteUserMutation.mutate(user.id)}
                          disabled={deleteUserMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
