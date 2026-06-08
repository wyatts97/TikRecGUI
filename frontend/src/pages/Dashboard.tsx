import { useQuery } from '@tanstack/react-query'
import { Video, Users, Radio, AlertCircle, Play, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api, type ActiveRecording } from '@/lib/api'
import { formatDuration } from '@/lib/utils'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.users.list(),
    refetchInterval: 30000,
  })

  const { data: activeRecordings = [] } = useQuery({
    queryKey: ['activeRecordings'],
    queryFn: () => api.recordings.getActive(),
    refetchInterval: 5000,
  })

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.settings.health(),
    refetchInterval: 60000,
  })

  const liveUsers = users.filter((u) => u.is_live)
  const monitoredUsers = users.filter((u) => u.is_monitoring)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-kraken-black tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Monitor TikTok live streams and manage recordings
        </p>
      </div>

      {health?.country_blacklisted && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <div>
              <p className="font-medium text-yellow-800">Region Restricted</p>
              <p className="text-sm text-yellow-700">
                TikTok access is restricted in your region. Configure cookies or use a proxy in Settings.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.length}</div>
            <p className="text-xs text-muted-foreground">
              {monitoredUsers.length} being monitored
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Live Now</CardTitle>
            <Radio className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{liveUsers.length}</div>
            <p className="text-xs text-muted-foreground">
              Users currently streaming
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Recordings</CardTitle>
            <Video className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeRecordings.length}</div>
            <p className="text-xs text-muted-foreground">
              Recordings in progress
            </p>
          </CardContent>
        </Card>

        <Card>
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

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-red-500" />
              Live Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            {liveUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No users are currently live
              </p>
            ) : (
              <div className="space-y-3">
                {liveUsers.slice(0, 5).map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary-subtle flex items-center justify-center overflow-hidden">
                        {user.profile_pic_url ? (
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
                        ) : null}
                        <span className={`text-sm font-medium text-primary ${user.profile_pic_url ? 'hidden' : 'flex'} items-center justify-center h-full w-full`}>
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5 text-primary" />
              Active Recordings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeRecordings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No active recordings
              </p>
            ) : (
              <div className="space-y-3">
                {activeRecordings.map((recording: ActiveRecording) => (
                  <div
                    key={recording.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
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
      </div>
    </div>
  )
}
