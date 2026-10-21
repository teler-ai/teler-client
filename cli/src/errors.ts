export class UsageError extends Error {
  readonly exitCode = 2
}

export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** What the person or agent can do next. */
    readonly hint?: string
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
    readonly capabilities?: readonly string[],
    /** What the person or agent can do next, when it is more specific than the code's. */
    readonly hint?: string
  ) {
    super(message)
  }
}

const RETRY_HINT =
  'Wait and retry; repeat a submission only with the same --idempotency-key, so it is not run twice.'

/** The next step for a refusal whose code or status names one; none otherwise. */
function apiHint(error: ApiError): string | undefined {
  if (error.hint) return error.hint
  const code = error.code ?? ''
  if (code === 'CLIENT_UPDATE_REQUIRED' || error.status === 426)
    return 'Run `teler update`, then retry.'
  if (code === 'PLAN_REQUIRED' || code === 'PLAN_LIMIT_EXCEEDED')
    return "Your organization's plan does not allow this; an owner can change the plan in the Teler app."
  if (code === 'INSUFFICIENT_CREDITS' || code === 'BUDGET_EXCEEDED')
    return 'Lower --max-credits to what the organization has, or add credits in the Teler app.'
  if (code === 'IDEMPOTENCY_CONFLICT')
    return 'That key belongs to a different task; use a new --idempotency-key for this one.'
  if (code.endsWith('APPROVAL_REQUIRED') || code === 'SESSION_NEEDS_APPROVAL')
    return 'A person must approve this in the Teler app (or re-run with --approve where the command offers it); then retry.'
  if (error.status === 401) return 'Run `teler auth login`, or set TELER_TOKEN.'
  if (error.status === 429 || error.status === 503) return RETRY_HINT
  return undefined
}

/** The next step a failure names, for `--json` errors and plain stderr. */
export function errorHint(error: unknown): string | undefined {
  if (error instanceof CommandError) return error.hint
  if (error instanceof ApiError) return apiHint(error)
  return undefined
}

/** Stable machine errors never project arbitrary exception or response text. */
export function jsonError(error: unknown) {
  if (error instanceof UsageError)
    return { error: { code: 'INVALID_INPUT', message: error.message, retryable: false } }
  const hint = errorHint(error)
  if (error instanceof CommandError)
    return {
      error: {
        code: error.code,
        message: error.message,
        retryable: false,
        ...(hint ? { hint } : {}),
      },
    }
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
        ...(hint ? { hint } : {}),
      },
    }
  }
  return {
    error: { code: 'INTERNAL_ERROR', message: 'Command could not be completed', retryable: false },
  }
}
