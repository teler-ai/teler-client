export class UsageError extends Error {
  readonly exitCode = 2
}

export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export class ApiError extends Error {
  readonly exitCode = 1

  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterMs?: number,
    /** Capability ids an approval refusal names. */
    readonly capabilities?: readonly string[]
  ) {
    super(message)
  }
}

/** Stable machine errors never project arbitrary exception or response text. */
export function jsonError(error: unknown) {
  if (error instanceof UsageError)
    return { error: { code: 'INVALID_INPUT', message: error.message, retryable: false } }
  if (error instanceof CommandError)
    return { error: { code: error.code, message: error.message, retryable: false } }
  if (error instanceof ApiError) {
    const retryable = error.status === 429 || error.status === 503
    return {
      error: {
        code: error.code ?? 'API_ERROR',
        message: error.message,
        status: error.status,
        retryable,
        ...(retryable ? { retrySafety: 'read-or-idempotent-only' } : {}),
        ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
        ...(error.capabilities ? { capabilities: error.capabilities } : {}),
      },
    }
  }
  return {
    error: { code: 'INTERNAL_ERROR', message: 'Command could not be completed', retryable: false },
  }
}
