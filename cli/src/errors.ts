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
    readonly hint?: string,
    /** Why a schedule was refused, when `code` is the generic SCHEDULE_REFUSED. */
    readonly reason?: string
  ) {
    super(message)
  }
}

/** The next step for a refused File schedule, by its reason. */
const REASON_HINTS: Readonly<Record<string, string>> = {
  SPEND_APPROVAL_REQUIRED:
    'Approve its monthly spend first: `teler schedule file quote <id>`, then `teler schedule file approve <id> --revision <n> --monthly-credits <amount> --yes`.',
  GRANT_EXPIRED:
    'Its approved spend has ended; run `teler schedule file quote <id>` and approve it again.',
  STALE_APPROVAL:
    'The quote is out of date; run `teler schedule file quote <id>` and approve the revision it shows.',
  CAP_INVALID:
    "Raise --monthly-credits to at least one run's hold (see `teler schedule file quote <id>`).",
  ADMIN_HOLD:
    'An organization owner or admin holds this schedule; only they can release it in the Teler app.',
}

const RETRY_HINT =
  'Wait and retry; repeat a submission only with the same --idempotency-key, so it is not run twice.'

/** The next step for a refusal whose code or status names one; none otherwise. */
function apiHint(error: ApiError): string | undefined {
  if (error.hint) return error.hint
  const reasonHint = error.reason ? REASON_HINTS[error.reason] : undefined
  if (reasonHint) return reasonHint
  const code = error.code ?? ''
  if (code === 'CLIENT_UPDATE_REQUIRED' || error.status === 426)
    return 'Run `teler update`, then retry.'
  if (code === 'PLAN_REQUIRED' || code === 'PLAN_LIMIT_EXCEEDED')
    return "Your organization's plan does not allow this; an owner can change the plan in the Teler app."
  if (code === 'INSUFFICIENT_CREDITS' || code === 'BUDGET_EXCEEDED')
    return 'Lower --max-credits to what the organization has, or add credits in the Teler app.'
  if (code === 'IDEMPOTENCY_CONFLICT' || code === 'RETRY_CONFLICT')
    return 'That key belongs to a different task; use a new --idempotency-key for this one.'
  if (code === 'STALE_REVISION')
    return 'It changed since you read it; read it again and retry with what it shows now.'
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
        ...(error.reason ? { reason: error.reason } : {}),
        ...(hint ? { hint } : {}),
      },
    }
  }
  return {
    error: { code: 'INTERNAL_ERROR', message: 'Command could not be completed', retryable: false },
  }
}
