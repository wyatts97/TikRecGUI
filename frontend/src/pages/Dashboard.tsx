import { useQuery } from '@tanstack/react-query'
import { Video, Users, Radio, AlertCircle, Play, Clock, Film, Settings, Plus, HardDrive, Activity, CheckCircle2 } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle } from 'components/selia/card'
import { Badge } from 'components/selia/badge'
import { Button } from 'components/selia/button'
import { Item, ItemContent, ItemTitle, ItemDescription, ItemMedia, ItemAction } from 'components/selia/item'
import { IconBox } from 'components/selia/icon-box'
import { Avatar, AvatarImage, AvatarFallback, AvatarIndicator } from 'components/selia/avatar'
import { Meter, MeterValue, MeterTrack, MeterIndicator } from 'components/selia/meter'
import EmptyState from '@/components/EmptyState'
import { api, type ActiveRecording } from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/utils'
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
          <CardBody className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-200">Region Restricted</p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                TikTok access is restricted in your region. Configure cookies or use a proxy in Settings.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-subtle transition-shadow cursor-pointer" onClick={() => navigate('/watchlist')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardBody>
            {usersLoading ? <div className="h-8 w-16 bg-muted animate-pulse rounded" /> : (
              <>
                <div className="text-2xl font-bold">{users.length}</div>
                <p className="text-xs text-muted-foreground">
                  {monitoredUsers.length} being monitored
                </p>
              </>
            )}
          </CardBody>
        </Card>

        <Card className="hover:shadow-subtle transition-shadow cursor-pointer border-l-4 border-l-red-500" onClick={() => navigate('/watchlist')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Live Now</CardTitle>
            <Radio className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardBody>
            {usersLoading ? <div className="h-8 w-16 bg-muted animate-pulse rounded" /> : (
              <>
                <div className="text-2xl font-bold">{liveUsers.length}</div>
                <p className="text-xs text-muted-foreground">
                  Users currently streaming
                </p>
              </>
            )}
          </CardBody>
        </Card>

        <Card className="hover:shadow-subtle transition-shadow cursor-pointer" onClick={() => navigate('/recordings')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Recordings</CardTitle>
            <Video className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardBody>
            {activeLoading ? <div className="h-8 w-16 bg-muted animate-pulse rounded" /> : (
              <>
                <div className="text-2xl font-bold">{activeRecordings.length}</div>
                <p className="text-xs text-muted-foreground">
                  Recordings in progress
                </p>
              </>
            )}
          </CardBody>
        </Card>

        <Card className="hover:shadow-subtle transition-shadow cursor-pointer border-l-4 border-l-success" onClick={() => navigate('/settings')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <div className={`h-2 w-2 rounded-full ${health?.status === 'healthy' ? 'bg-success' : 'bg-yellow-500'}`} />
          </CardHeader>
          <CardBody>
            <div className="text-2xl font-bold capitalize">{health?.status || 'Unknown'}</div>
            <p className="text-xs text-muted-foreground">
              {health?.cookies_configured ? 'Cookies configured' : 'No cookies set'}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Storage indicator card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            Storage
          </CardTitle>
          <Button
            variant="plain"
            size="sm"
            onClick={() => navigate('/settings')}
          >
            <IconBox variant="secondary-subtle" size="sm">
              <Settings className="h-3.5 w-3.5" />
            </IconBox>
          </Button>
        </CardHeader>
        <CardBody>
          {health?.disk_usage ? (() => {
            const { total, used, free, percent } = health.disk_usage
            const freePercent = 100 - percent
            const indicatorColor = freePercent > 20 ? 'bg-success' : freePercent > 10 ? 'bg-warning' : 'bg-danger'
            const textColor = freePercent > 20 ? 'text-success' : freePercent > 10 ? 'text-warning' : 'text-danger'
            return (
              <Meter value={percent}>
                <div className="flex items-center justify-between">
                  <MeterValue>{formatBytes(used)} used</MeterValue>
                  <MeterValue>{formatBytes(total)} total</MeterValue>
                </div>
                <MeterTrack>
                  <MeterIndicator className={indicatorColor} />
                </MeterTrack>
                <div className="flex items-center justify-between text-xs">
                  <span className={textColor}>
                    {formatBytes(free)} free ({freePercent.toFixed(1)}%)
                  </span>
                  {freePercent <= 20 && (
                    <Badge variant="danger" size="sm" className="text-[10px]">
                      Low space
                    </Badge>
                  )}
                </div>
              </Meter>
            )
          })() : dirExists === false ? (
            <p className="text-xs text-destructive flex items-center gap-1">
              {/* Keep using a simple text indicator */}
              Recordings directory does not exist. Check your settings.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground truncate">{recordingsDir}</p>
          )}
        </CardBody>
      </Card>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => navigate('/watchlist')}>
          <Plus className="h-4 w-4" />
          Add User
        </Button>
        <Button variant="secondary" onClick={() => navigate('/recordings')}>
          <Film className="h-4 w-4" />
          New Recording
        </Button>
        <Button variant="secondary" onClick={() => navigate('/settings')}>
          <Settings className="h-4 w-4" />
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
          <CardBody>
            {usersLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3">
                    <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                      <div className="h-3 w-20 bg-muted animate-pulse rounded" />
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
              <div className="space-y-1">
                {liveUsers.slice(0, 5).map((user) => (
                  <Item key={user.id} size="md">
                    <ItemMedia>
                      <Avatar size="md">
                        <AvatarImage
                          src={api.users.getAvatarUrl(user.id)}
                          alt={user.username}
                        />
                        <AvatarFallback>
                          {user.username[0].toUpperCase()}
                        </AvatarFallback>
                        <AvatarIndicator className="bg-success ring-2 ring-background" />
                      </Avatar>
                    </ItemMedia>
                    <ItemContent>
                      {user.display_name && (
                        <ItemTitle>{user.display_name}</ItemTitle>
                      )}
                      <ItemDescription>@{user.username}</ItemDescription>
                    </ItemContent>
                    <ItemAction>
                      <Link to={`/watchlist?record=${user.id}`}>
                        <Button size="sm" variant="secondary">
                          <Play className="h-3 w-3 mr-1" />
                          Record
                        </Button>
                      </Link>
                    </ItemAction>
                  </Item>
                ))}
                {liveUsers.length > 5 && (
                  <Link to="/watchlist" className="block">
                    <Button variant="plain" className="w-full">
                      View all {liveUsers.length} live users
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Active Recordings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5 text-primary" />
              Active Recordings
            </CardTitle>
          </CardHeader>
          <CardBody>
            {activeLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3">
                    <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                      <div className="h-3 w-20 bg-muted animate-pulse rounded" />
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
              <div className="space-y-1">
                {activeRecordings.map((recording: ActiveRecording) => (
                  <Item key={recording.id} variant="danger" size="md">
                    <ItemMedia>
                      <Avatar size="md">
                        <AvatarImage
                          src={api.users.getAvatarUrl(recording.user_id)}
                          alt={recording.username}
                        />
                        <AvatarFallback className="bg-danger/20 text-danger">
                          {recording.username[0].toUpperCase()}
                        </AvatarFallback>
                        <AvatarIndicator className="bg-danger animate-pulse ring-2 ring-background" />
                      </Avatar>
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>@{recording.username}</ItemTitle>
                      <ItemDescription className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDuration(recording.duration_seconds)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemAction>
                      <Badge variant="danger">Recording</Badge>
                    </ItemAction>
                  </Item>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Activity Feed */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardBody>
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
                  const iconVariant =
                    item.type === 'recording' ? 'success-subtle' : 'danger-subtle'
                  return (
                    <Item
                      key={item.id}
                      className="cursor-pointer hover:bg-accent transition-colors"
                      onClick={item.onClick}
                    >
                      <ItemMedia>
                        <IconBox variant={iconVariant} size="md" circle>
                          <Icon className="h-4 w-4" />
                        </IconBox>
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="font-normal truncate">{item.label}</ItemTitle>
                        <ItemDescription>{fmt(item.timestamp)}</ItemDescription>
                      </ItemContent>
                    </Item>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
