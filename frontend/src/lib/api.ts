export const API_BASE = "/api"

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }))
    throw new Error(error.detail || "Request failed")
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

export interface User {
  id: number
  username: string
  display_name: string | null
  bio: string | null
  follower_count: number | null
  profile_pic_url: string | null
  room_id: string | null
  is_monitoring: boolean
  is_live: boolean
  last_checked: string | null
  created_at: string
  updated_at: string
}

export interface Recording {
  id: number
  user_id: number
  username: string
  filename: string
  status: string
  mode: string
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  file_size: number | null
  error_message: string | null
  created_at: string
  thumbnail_ready: boolean
  sprite_ready: boolean
  transcript_status: string | null
  transcript_text: string | null
  is_favorite: boolean
}

export interface RecordingListResponse {
  recordings: Recording[]
  total: number
  page: number
  page_size: number
}

export interface Clip {
  id: number
  recording_id: number
  username: string
  title: string | null
  filename: string
  start_time: number
  end_time: number
  duration_seconds: number | null
  file_size: number | null
  thumbnail_ready: boolean
  sprite_ready: boolean
  is_favorite: boolean
  created_at: string
}

export interface LiveEvent {
  id: number
  recording_id: number
  offset_seconds: number
  event_type: "chat" | "gift"
  user_nickname: string
  user_unique_id: string | null
  content: string | null
  gift_name: string | null
  gift_diamond_count: number | null
  gift_repeat_count: number | null
  created_at: string
}

export interface LiveEventListResponse {
  events: LiveEvent[]
  total: number
}

export interface ClipListResponse {
  clips: Clip[]
  total: number
  page: number
  page_size: number
}

export interface ActiveRecording {
  id: number
  user_id: number
  username: string
  status: string
  started_at: string | null
  duration_seconds: number | null
  room_id: string | null
}

export interface AutoCleanupConfig {
  enabled: boolean
  days: number
  action: "delete" | "compress"
}

export interface Settings {
  cookies: {
    sessionid_ss: string
    tt_target_idc: string
  }
  telegram: {
    api_id: string
    api_hash: string
    chat_id: string
  }
  proxy: string | null
  output_dir: string
  default_bitrate: string | null
  automatic_interval: number
  auto_cleanup: AutoCleanupConfig
  timezone: string
}

export interface DiskUsage {
  total: number
  used: number
  free: number
  percent: number
}

export interface HealthStatus {
  status: string
  recorder_available: boolean
  country_blacklisted: boolean
  cookies_configured: boolean
  recordings_dir: string
  recordings_dir_exists: boolean
  disk_usage: DiskUsage | null
}

export interface MonitorStatus {
  is_running: boolean
  last_check_at: string | null
  next_check_in_seconds: number | null
  interval_minutes: number
  check_interval: number
}

export const api = {
  users: {
    list: (monitoringOnly = false, watchlistOnly = true) =>
      fetchApi<User[]>(`/users?monitoring_only=${monitoringOnly}&watchlist_only=${watchlistOnly}`),
    
    create: (username: string, isMonitoring = false) =>
      fetchApi<User>("/users", {
        method: "POST",
        body: JSON.stringify({ username, is_monitoring: isMonitoring }),
      }),
    
    get: (id: number) => fetchApi<User>(`/users/${id}`),
    
    update: (id: number, data: { is_monitoring?: boolean; room_id?: string }) =>
      fetchApi<User>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    
    removeFromWatchlist: (id: number) =>
      fetchApi<User>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_on_watchlist: false }),
      }),
    delete: (id: number) =>
      fetchApi<void>(`/users/${id}`, { method: "DELETE" }),
    
    checkStatus: (id: number) =>
      fetchApi<{ username: string; is_live: boolean; room_id: string | null; last_checked: string }>(
        `/users/${id}/status`
      ),
    
    refresh: (id: number, refreshProfile = false) =>
      fetchApi<User>(`/users/${id}/refresh?refresh_profile=${refreshProfile}`, { method: "POST" }),
    
    getAvatarUrl: (id: number) => `${API_BASE}/users/${id}/avatar`,
  },

  recordings: {
    list: (
      page = 1,
      pageSize = 20,
      statusFilter?: string,
      userId?: number,
      filters?: {
        sortBy?: string
        sortOrder?: string
        usernameFilter?: string
        minSize?: number
        maxSize?: number
        dateFrom?: string
        dateTo?: string
        favoritesOnly?: boolean
      }
    ) => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      })
      if (statusFilter) params.set("status_filter", statusFilter)
      if (userId) params.set("user_id", userId.toString())
      if (filters?.sortBy) params.set("sort_by", filters.sortBy)
      if (filters?.sortOrder) params.set("sort_order", filters.sortOrder)
      if (filters?.usernameFilter) params.set("username_filter", filters.usernameFilter)
      if (filters?.minSize !== undefined) params.set("min_size", filters.minSize.toString())
      if (filters?.maxSize !== undefined) params.set("max_size", filters.maxSize.toString())
      if (filters?.dateFrom) params.set("date_from", filters.dateFrom)
      if (filters?.dateTo) params.set("date_to", filters.dateTo)
      if (filters?.favoritesOnly) params.set("favorites_only", "true")
      return fetchApi<RecordingListResponse>(`/recordings?${params}`)
    },
    
    start: (data: {
      username?: string
      url?: string
      room_id?: string
      mode?: string
      duration?: number
      bitrate?: string
    }) =>
      fetchApi<Recording>("/recordings/start", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    
    get: (id: number) => fetchApi<Recording>(`/recordings/${id}`),
    
    stop: (id: number) =>
      fetchApi<Recording>(`/recordings/${id}/stop`, { method: "POST" }),
    
    delete: (id: number) =>
      fetchApi<void>(`/recordings/${id}`, { method: "DELETE" }),
    
    getActive: () => fetchApi<ActiveRecording[]>("/recordings/active"),

    getLiveUrl: (id: number) =>
      fetchApi<{ live_url: string }>(`/recordings/${id}/live-url`),

    toggleFavorite: (id: number) =>
      fetchApi<Recording>(`/recordings/${id}/favorite`, { method: "POST" }),

    getDownloadUrl: (id: number) => `${API_BASE}/recordings/${id}/download`,
    getStreamUrl: (id: number) => `${API_BASE}/recordings/${id}/stream`,
    getThumbnailUrl: (id: number) => `${API_BASE}/recordings/${id}/thumbnail`,
    getSpriteVttUrl: (id: number) => `${API_BASE}/recordings/${id}/thumbnails.vtt`,

    transcribe: (id: number) =>
      fetchApi<Recording>(`/recordings/${id}/transcribe`, { method: "POST" }),

    searchTranscripts: (q: string) =>
      fetchApi<{ recording_id: number; username: string; snippet: string }[]>(
        `/recordings/transcripts/search?q=${encodeURIComponent(q)}`
      ),
    
    batchDelete: (ids: number[]) =>
      fetchApi<{ deleted: number; errors: string[] }>("/recordings/batch/delete", {
        method: "POST",
        body: JSON.stringify({ recording_ids: ids }),
      }),

    stopAll: () =>
      fetchApi<{ stopped: number }>("/recordings/stop-all", { method: "POST" }),
    
    getEvents: (id: number, page = 1, pageSize = 100, eventType?: string, search?: string) => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      })
      if (eventType) params.set("event_type", eventType)
      if (search) params.set("search", search)
      return fetchApi<LiveEventListResponse>(`/recordings/${id}/events?${params}`)
    },

    batchDownload: async (ids: number[]) => {
      const response = await fetch(`${API_BASE}/recordings/batch/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recording_ids: ids }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Download failed" }))
        throw new Error(error.detail || "Download failed")
      }
      return response.blob()
    },
  },

  clips: {
    create: (data: {
      recording_id: number
      start_time: number
      end_time: number
      title?: string | null
    }) =>
      fetchApi<Clip>("/clips", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    list: (page = 1, pageSize = 20, sortBy?: string, sortOrder?: string) => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      })
      if (sortBy) params.set("sort_by", sortBy)
      if (sortOrder) params.set("sort_order", sortOrder)
      return fetchApi<ClipListResponse>(`/clips?${params}`)
    },

    get: (id: number) => fetchApi<Clip>(`/clips/${id}`),

    delete: (id: number) => fetchApi<void>(`/clips/${id}`, { method: "DELETE" }),

    toggleFavorite: (id: number) =>
      fetchApi<Clip>(`/clips/${id}/favorite`, { method: "POST" }),

    updateTitle: (id: number, title: string | null) =>
      fetchApi<Clip>(`/clips/${id}?title=${encodeURIComponent(title || "")}`, {
        method: "PATCH",
      }),

    getDownloadUrl: (id: number) => `${API_BASE}/clips/${id}/download`,
    getStreamUrl: (id: number) => `${API_BASE}/clips/${id}/stream`,
    getThumbnailUrl: (id: number) => `${API_BASE}/clips/${id}/thumbnail`,
    getSpriteVttUrl: (id: number) => `${API_BASE}/clips/${id}/thumbnails.vtt`,
  },

  settings: {
    get: () => fetchApi<Settings>("/settings"),
    
    update: (data: Partial<Settings>) =>
      fetchApi<Settings>("/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    
    health: () => fetchApi<HealthStatus>("/settings/health"),
    
    getCleanupStats: () => 
      fetchApi<{ count: number; total_size: number; days: number }>("/settings/cleanup/stats"),
    
    runCleanup: () =>
      fetchApi<{ status: string; deleted: number; compressed: number; backup_file?: string }>(
        "/settings/cleanup/run",
        { method: "POST" }
      ),

    getMonitorStatus: () =>
      fetchApi<MonitorStatus>("/settings/monitor-status"),

    triggerMonitorCheck: () =>
      fetchApi<{ triggered: boolean }>("/settings/monitor-check", { method: "POST" }),
  },
}
