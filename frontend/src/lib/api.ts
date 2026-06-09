const API_BASE = "/api"

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
}

export interface RecordingListResponse {
  recordings: Recording[]
  total: number
  page: number
  page_size: number
}

export interface ActiveRecording {
  id: number
  username: string
  status: string
  started_at: string | null
  duration_seconds: number | null
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

export interface HealthStatus {
  status: string
  recorder_available: boolean
  country_blacklisted: boolean
  cookies_configured: boolean
  recordings_dir: string
  recordings_dir_exists: boolean
}

export interface MonitorStatus {
  is_running: boolean
  last_check_at: string | null
  next_check_in_seconds: number | null
  interval_minutes: number
}

export const api = {
  users: {
    list: (monitoringOnly = false) =>
      fetchApi<User[]>(`/users?monitoring_only=${monitoringOnly}`),
    
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
    
    delete: (id: number) =>
      fetchApi<void>(`/users/${id}`, { method: "DELETE" }),
    
    checkStatus: (id: number) =>
      fetchApi<{ username: string; is_live: boolean; room_id: string | null; last_checked: string }>(
        `/users/${id}/status`
      ),
    
    refresh: (id: number) =>
      fetchApi<User>(`/users/${id}/refresh`, { method: "POST" }),
    
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
