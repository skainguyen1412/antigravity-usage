/**
 * Custom error classes for antigravity-usage CLI
 */

export class NotLoggedInError extends Error {
  constructor(message = 'Not logged in. Run: antigravity-usage login') {
    super(message)
    this.name = 'NotLoggedInError'
  }
}

export class AuthenticationError extends Error {
  constructor(message = 'Authentication failed. Please login again.') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network error. Please check your connection.') {
    super(message)
    this.name = 'NetworkError'
  }
}

export class RateLimitError extends Error {
  retryAfterMs?: number

  constructor(message = 'Rate limited. Please try again later.', retryAfterMs?: number) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

export class APIError extends Error {
  statusCode?: number
  
  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'APIError'
    this.statusCode = statusCode
  }
}

export class TokenRefreshError extends Error {
  /** Original error that caused the refresh failure */
  cause?: Error
  /** HTTP status code if available */
  statusCode?: number
  /** Whether the error is retryable (network issues) vs permanent (invalid token) */
  isRetryable: boolean
  
  constructor(
    message = 'Failed to refresh token. Please login again.',
    options?: {
      cause?: Error
      statusCode?: number
      isRetryable?: boolean
    }
  ) {
    super(message)
    this.name = 'TokenRefreshError'
    this.cause = options?.cause
    this.statusCode = options?.statusCode
    // Default: retryable unless we get a 400/401 (invalid_grant, etc.)
    this.isRetryable = options?.isRetryable ?? true
  }
  
  /** Get detailed error message including cause */
  getDetailedMessage(): string {
    let msg = this.message
    if (this.statusCode) {
      msg += ` (HTTP ${this.statusCode})`
    }
    if (this.cause) {
      msg += `: ${this.cause.message}`
    }
    return msg
  }
}

export class AntigravityNotRunningError extends Error {
  constructor(message = 'Antigravity language server is not running. Please start Antigravity in your IDE.') {
    super(message)
    this.name = 'AntigravityNotRunningError'
  }
}

export class LocalConnectionError extends Error {
  constructor(message = 'Failed to connect to local Antigravity server.') {
    super(message)
    this.name = 'LocalConnectionError'
  }
}

export class PortDetectionError extends Error {
  constructor(message = 'Could not detect Antigravity server port.') {
    super(message)
    this.name = 'PortDetectionError'
  }
}

export class NoAuthMethodAvailableError extends Error {
  constructor(message = 'Unable to fetch quota: Antigravity is not running and you are not logged in.\n\nPlease do one of the following:\n  • Run Antigravity in your IDE (VSCode, etc.), or\n  • Login with: antigravity-usage login') {
    super(message)
    this.name = 'NoAuthMethodAvailableError'
  }
}

