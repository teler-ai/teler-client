import { takeOption } from './command-args'
import { ApiError } from './errors'
import type { RunResponse } from './run-contract'

/**
 * How long `--wait` also waits for the person to answer a run's approval request, when no
 * `--timeout` is given: as long as the request stays open.
 */
export const APPROVAL_WAIT_SECONDS = 15 * 60

/** `--capabilities a,b`: the exact capability ids a run asks for; undefined for the default. */
export function takeRunCapabilities(args: string[]): string[] | undefined {
  const value = takeOption(args, '--capabilities')
  if (value === undefined) return undefined
  const listed = value
    .split(',')
    .map((capability) => capability.trim())
    .filter(Boolean)
  return [...new Set(listed)]
}

/** Where the person approves a waiting run, on the configured origin; undefined otherwise. */
export function approvalUrl(run: RunResponse, origin: URL): string | undefined {
  if (run.status !== 'needs_approval' || !run.approval) return undefined
  return new URL(run.approval.path, origin).toString()
}

/** What to tell the person about a run waiting for their approval. */
export function approvalHint(run: RunResponse, origin: URL): string | undefined {
  const url = approvalUrl(run, origin)
  if (!url || !run.approval) return undefined
  const asks = run.approval.asks.map((ask) => ask.capability).join(', ')
  return (
    `Ask the person to approve ${asks} in the Teler app: ${url} (by ${run.approval.expiresAt}). ` +
    'The run starts once they approve it, and is cancelled if they deny it or the request expires.'
  )
}

/** The next step for a failed run that left out what Agent Access asks about first. */
export function leftOutHint(leftOut: readonly string[]): string | undefined {
  if (!leftOut.length) return undefined
  return (
    `This run left out ${leftOut.join(', ')}, which your Agent Access asks about first. ` +
    'If the code needs one, submit it again with --capabilities listing every capability it ' +
    'uses; the person approves the run in the Teler app.'
  )
}

const GUIDANCE: Readonly<Record<string, (list: string) => string>> = {
  CAPABILITY_APPROVAL_REQUIRED: (list) =>
    `Your Agent Access asks before a run uses ${list}. Submit it again with --capabilities ` +
    `${list}, adding every other capability the code uses; the person approves it in the Teler app`,
  CAPABILITY_REQUIRED: (list) => `This run also needs ${list}; add it to --capabilities`,
  CAPABILITY_DENIED: (list) => `Your Agent Access does not allow ${list}`,
}

/** Name what to pass in `--capabilities`, or what policy denies, instead of a bare status. */
export async function withRunCapabilityGuidance<T>(submit: () => Promise<T>): Promise<T> {
  try {
    return await submit()
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (error.code === 'UNSUPPORTED_CAPABILITY')
      throw new ApiError(
        '--capabilities names a capability a run cannot use; a run reads data and changes Files and tables',
        error.status,
        error.code
      )
    const guide = error.code ? GUIDANCE[error.code] : undefined
    if (!guide || !error.capabilities?.length) throw error
    throw new ApiError(
      guide(error.capabilities.join(',')),
      error.status,
      error.code,
      undefined,
      error.capabilities,
      error.hint,
      error.reason
    )
  }
}
