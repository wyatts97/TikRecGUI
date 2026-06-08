import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, type Settings } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings.get(),
  })

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.settings.health(),
    refetchInterval: 60000,
  })

  const [formData, setFormData] = useState<Partial<Settings>>({})

  useEffect(() => {
    if (settings) {
      setFormData(settings)
    }
  }, [settings])

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<Settings>) => api.settings.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      toast({ title: 'Settings saved', description: 'Your settings have been updated' })
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    },
  })

  const handleSave = () => {
    updateSettingsMutation.mutate(formData)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-kraken-black tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Configure your TikTok recorder settings
          </p>
        </div>
        <Button onClick={handleSave} disabled={updateSettingsMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {updateSettingsMutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
            <CardDescription>Current system health and configuration status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <span className="text-sm font-medium">API Status</span>
              <div className="flex items-center gap-2">
                {health?.status === 'healthy' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="text-sm text-success">Healthy</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm text-yellow-600">Unknown</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <span className="text-sm font-medium">Region Status</span>
              <div className="flex items-center gap-2">
                {health?.country_blacklisted ? (
                  <>
                    <AlertCircle className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm text-yellow-600">Restricted</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="text-sm text-success">OK</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <span className="text-sm font-medium">Cookies</span>
              <div className="flex items-center gap-2">
                {health?.cookies_configured ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="text-sm text-success">Configured</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Not Set</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <span className="text-sm font-medium">Output Directory</span>
              <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                {health?.recordings_dir || settings?.output_dir}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>TikTok Cookies</CardTitle>
            <CardDescription>
              Required for accessing restricted content.{' '}
              <a
                href="https://github.com/Michele0303/tiktok-live-recorder/blob/main/docs/GUIDE.md#how-to-set-cookies"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Learn how <ExternalLink className="h-3 w-3" />
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="sessionid_ss">Session ID (sessionid_ss)</Label>
              <Input
                id="sessionid_ss"
                type="password"
                placeholder="Enter your TikTok session ID"
                value={formData.cookies?.sessionid_ss || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    cookies: {
                      ...formData.cookies,
                      sessionid_ss: e.target.value,
                      tt_target_idc: formData.cookies?.tt_target_idc || 'useast2a',
                    },
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tt_target_idc">Target IDC (tt-target-idc)</Label>
              <Input
                id="tt_target_idc"
                placeholder="useast2a"
                value={formData.cookies?.tt_target_idc || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    cookies: {
                      ...formData.cookies,
                      sessionid_ss: formData.cookies?.sessionid_ss || '',
                      tt_target_idc: e.target.value,
                    },
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Telegram Integration</CardTitle>
            <CardDescription>
              Upload recordings to Telegram automatically.{' '}
              <a
                href="https://github.com/Michele0303/tiktok-live-recorder/blob/main/docs/GUIDE.md#how-to-enable-upload-to-telegram"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Learn how <ExternalLink className="h-3 w-3" />
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="api_id">API ID</Label>
              <Input
                id="api_id"
                placeholder="Enter your Telegram API ID"
                value={formData.telegram?.api_id || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    telegram: {
                      ...formData.telegram,
                      api_id: e.target.value,
                      api_hash: formData.telegram?.api_hash || '',
                      chat_id: formData.telegram?.chat_id || 'me',
                    },
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="api_hash">API Hash</Label>
              <Input
                id="api_hash"
                type="password"
                placeholder="Enter your Telegram API Hash"
                value={formData.telegram?.api_hash || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    telegram: {
                      ...formData.telegram,
                      api_id: formData.telegram?.api_id || '',
                      api_hash: e.target.value,
                      chat_id: formData.telegram?.chat_id || 'me',
                    },
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="chat_id">Chat ID</Label>
              <Input
                id="chat_id"
                placeholder="me"
                value={formData.telegram?.chat_id || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    telegram: {
                      ...formData.telegram,
                      api_id: formData.telegram?.api_id || '',
                      api_hash: formData.telegram?.api_hash || '',
                      chat_id: e.target.value,
                    },
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recording Settings</CardTitle>
            <CardDescription>Configure default recording behavior</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="proxy">HTTP Proxy</Label>
              <Input
                id="proxy"
                placeholder="http://127.0.0.1:8080"
                value={formData.proxy || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    proxy: e.target.value || null,
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Use a proxy to bypass regional restrictions
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bitrate">Default Bitrate</Label>
              <Input
                id="bitrate"
                placeholder="e.g., 1M, 1000k (leave empty for original)"
                value={formData.default_bitrate || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    default_bitrate: e.target.value || null,
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="interval">Automatic Check Interval (minutes)</Label>
              <Input
                id="interval"
                type="number"
                min="1"
                placeholder="5"
                value={formData.automatic_interval || 5}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    automatic_interval: parseInt(e.target.value) || 5,
                  })
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
