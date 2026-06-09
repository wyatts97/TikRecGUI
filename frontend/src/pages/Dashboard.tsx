import { useQuery } from '@tanstack/react-query'
import { Video, Users, Radio, AlertCircle, Play, Clock, Film, Settings, Plus, HardDrive, XCircle, Activity } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/EmptyState'
import { api, type ActiveRecording } from '@/lib/api'
import { formatDuration } from '@/lib/utils'
import { useDateFormat } from '@/lib/timezone-context'
import { Link, useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const navigate = useNavigate()
  const fmt = useDateFormat()

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.users.list(),
    refetchInterval: 30000,
  })

  const { data: activeRecordings = [], isLoading: activeLoading } = useQuery({
    queryKey: ['activeRecordings'],
    queryFn: () => api.recordings.getActive(),
    refetchInterval: 5000,
  })

  const { data: recentRecordings } = useQuery({
    queryKey: ['recordings', 'recent'],
    queryFn: () => api.recordings.list(1, 7, 'completed,stopped'),
  })

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.settings.health(),
    refetchInterval: 60000,
  })

  const liveUsers = users.filter((u) => u.is_live)
  const monitoredUsers = users.filter((u) => u.is_monitoring)

  // Simulated disk stats — using recordings_dir info from health
  const recordingsDir = health?.recordings_dir || 'N/A'
  const dirExists = health?.recordings_dir_exists

  // Build activity feed from recent recordings and live users
  const activityItems = [
    ...(recentRecordings?.recordings || []).map((r) => ({
      id: `rec-${r.id}`,
      type: 'recording' as const,
      label: `Recording completed: @${r.username}`,
      timestamp: r.ended_at || r.created_at,
      icon: CheckCircle2,
      iconClass: 'text-success',
      onClick: () => navigate(`/watch/${r.id}`),
    })),
    ...liveUsers.slice(0, 5).map((u) => ({
      id: `live-${u.id}`,
      type: 'live' as const,
      label: `@${u.username} went live`,
      timestamp: u.last_checked || u.updated_at,
      icon: Radio,
      iconClass: 'text-red-500',
      onClick: () => navigate('/watchlist'),
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 7)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Monitor TikTok live streams and manage recordings
        </p>
      </div>

      {health?.country_blacklisted && (
        <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-900">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-200">Region Restricted</p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                TikTok access is restricted in your region. Configure cookies or use a proxy in Settings.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-subtle transition-shadow cursor-pointer" onClick={() => navigate('/watchlist')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {usersLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold">{users.length}</div>
                <p className="text-xs text-muted-foreground">
                  {monitoredUsers.length} being monitored
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="hover:shadow-subtle transition-shadow cursor-pointer border-l-4 border-l-red-500" onClick={() => navigate('/watchlist')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Live Now</CardTitle>
            <Radio className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {usersLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold">{liveUsers.length}</div>
                <p className="text-xs text-muted-foreground">
                  Users currently streaming
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="hover:shadow-subtle transition-shadow cursor-pointer" onClick={() => navigate('/recordings')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Recordings</CardTitle>
            <Video className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {activeLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold">{activeRecordings.length}</div>
                <p className="text-xs text-muted-foreground">
                  Recordings in progress
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="hover:shadow-subtle transition-shadow cursor-pointer border-l-4 border-l-success" onClick={() => navigate('/settings')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <div className={`h-2 w-2 rounded-full ${health?.status === 'healthy' ? 'bg-success' : 'bg-yellow-500'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{health?.status || 'Unknown'}</div>
            <p className="text-xs text-muted-foreground">
              {health?.cookies_configured ? 'Cookies configured' : 'No cookies set'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Storage card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            Storage
          </CardTitle>
          {dirExists === true && (
            <Badge variant="outline" className="text-xs">Directory OK</Badge>
          )}
          {dirExists === false && (
            <Badge variant="destructive" className="text-xs">Missing</Badge>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground truncate">{recordingsDir}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/settings')}
            >
              <Settings className="h-3 w-3 mr-1" />
              Configure
            </Button>
          </div>
          {dirExists === false && (
            <p className="text-xs text-destructive mt-2 flex items-center gap-1">
              <XCircle className="h-3 w-3" />
              Recordings directory does not exist. Check your settings.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => navigate('/watchlist')}>
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
        <Button variant="outline" onClick={() => navigate('/recordings')}>
          <Film className="h-4 w-4 mr-2" />
          New Recording
        </Button>
        <Button variant="outline" onClick={() => navigate('/settings')}>
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Live Users */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-red-500" />
              Live Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : liveUsers.length === 0 ? (
              <div className="py-4">
                <EmptyState
                  icon={Radio}
                  title="No users live"
                  description="No users are currently live. Add users to your watchlist to monitor them."
                />
              </div>
            ) : (
              <div className="space-y-3">
                {liveUsers.slice(0, 5).map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/40"
                  >
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
                        <span className="text-sm font-medium text-primary hidden items-center justify-center h-full w-full fallback-initial">
                          {user.username[0].toUpperCase()}
                        </span>
                      </div>
                      <div>
                        {user.display_name && (
                          <p className="font-medium text-sm">{user.display_name}</p>
                        )}
                        <p className={user.display_name ? "text-xs text-muted-foreground" : "font-medium text-sm"}>
                          @{user.username}
                        </p>
                        <Badge variant="live" className="text-xs">LIVE</Badge>
                      </div>
                    </div>
                    <Link to={`/watchlist?record=${user.id}`}>
                      <Button size="sm" variant="subtle">
                        <Play className="h-3 w-3 mr-1" />
                        Record
                      </Button>
                    </Link>
                  </div>
                ))}
                {liveUsers.length > 5 && (
                  <Link to="/watchlist" className="block">
                    <Button variant="ghost" className="w-full">
                      View all {liveUsers.length} live users
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Recordings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5 text-primary" />
              Active Recordings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activeRecordings.length === 0 ? (
              <div className="py-4">
                <EmptyState
                  icon={Video}
                  title="No active recordings"
                  description="Active recordings from live streams will appear here."
                />
              </div>
            ) : (
              <div className="space-y-3">
                {activeRecordings.map((recording: ActiveRecording) => (
                  <div
                    key={recording.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/40"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">@{recording.username}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDuration(recording.duration_seconds)}
                        </div>
                      </div>
                    </div>
                    <Badge variant="recording">Recording</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityItems.length === 0 ? (
              <div className="py-4">
                <EmptyState
                  icon={Activity}
                  title="No activity yet"
                  description="Recent activity from recordings and live users will appear here."
                />
              </div>
            ) : (
              <div className="space-y-1">
                {activityItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 cursor-pointer transition-colors"
                      onClick={item.onClick}
                    >
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <Icon className={`h-4 w-4 ${item.iconClass}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmt(item.timestamp)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
