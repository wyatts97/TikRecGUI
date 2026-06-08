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
}

export interface HealthStatus {
  status: string
  country_blacklisted: boolean
  cookies_configured: boolean
  recordings_dir: string
  recordings_dir_exists: boolean
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
  },

  recordings: {
    list: (page = 1, pageSize = 20, statusFilter?: string, userId?: number) => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      })
      if (statusFilter) params.set("status_filter", statusFilter)
      if (userId) params.set("user_id", userId.toString())
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
  },

  settings: {
    get: () => fetchApi<Settings>("/settings"),
    
    update: (data: Partial<Settings>) =>
      fetchApi<Settings>("/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    
    health: () => fetchApi<HealthStatus>("/settings/health"),
  },
}
