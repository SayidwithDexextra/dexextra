export interface HelloPostRequest {
  message: string
}

export interface HelloResponse {
  message: string
  timestamp: string
  method: 'GET' | 'POST'
  data?: Record<string, unknown>
  error?: string
}

export interface ApiError {
  error: string
  status?: number
} 