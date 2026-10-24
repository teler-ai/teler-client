import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { emitJson } from './command-output'
import { ApiError, CommandError } from './errors'
import { runResponseSchema, type RunResponse } from './run-contract'

export interface RunWatchDependencies {
  now?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

export function runPath(id: string, organizationId: string, cancel = false): string {
  const query = new URLSearchParams({ organizationId })
  return `/api/runs/${id}${cancel ? '/cancel' : ''}?${query}`
}

// Terminal control sequences and characters in server-relayed text, kept off the terminal.
const TERMINAL_CONTROL =
  // eslint-disable-next-line no-control-regex -- matching control text is the point
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b\n]*(?:\x07|\x1b\\)?|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/** Where to ask when a run needs more than the sandbox allows; fixed, never taken from the server. */
const CONTACT_SALES = 'Contact sales: https://teler.ai/contact?topic=sales'

/**
 * What a failed run needed, when the server says it stopped at a limit of the sandbox. Only the
 * `limit` object counts: a run's own `--execution-timeout` also ends in `time_limit`.
 */
function limitNeed(run: RunResponse): string | undefined {
  if (run.status !== 'failed') return undefined
  switch (run.limit?.kind) {
    case 'memory_limit':
    case 'time_limit':
      return 'needs more compute than is available here.'
    case 'gpu_needed':
      return 'needs a GPU.'
    default:
      return undefined
  }
}

export function emitRunReceipt(output: Output, run: RunResponse): void {
  if (output.json) {
    const need = limitNeed(run)
    return emitJson(output, need ? { ...run, hint: `This request ${need} ${CONTACT_SALES}` } : run)
  }
  output.write(
    `${run.id}\t${run.status}\t${run.language}\tcharged=${run.chargedCredits ?? 'pending'}\n`
  )
  if (!output.metadataOnly && run.output) output.write(`${run.output.replace(/\n$/, '')}\n`)
  const detail = run.errorDetail?.replace(TERMINAL_CONTROL, '').trim()
  if (!output.metadataOnly && detail) output.write(`${detail}\n`)
  for (const artifact of run.artifacts)
    output.write(`artifact\t${artifact.id}\t${artifact.slug}\t${artifact.type}\n`)
}

export function isTerminalRun(run: RunResponse): boolean {
  return ['completed', 'failed', 'cancelled'].includes(run.status)
}

const RESUBMIT = 'submit it again with a new --idempotency-key (the same key returns this run)'

/** What to change before trying again, by the run's error code. */
function failedRunHint(run: RunResponse): string | undefined {
  switch (run.errorCode) {
    case 'execution_failed':
      return run.errorDetail
        ? `Fix the code using the traceback in errorDetail, then ${RESUBMIT}.`
        : `Fix the code, then ${RESUBMIT}.`
    case 'time_limit':
      return `Raise --execution-timeout (up to your plan's limit) or do less per run, then ${RESUBMIT}.`
    case 'budget_exhausted':
      return `Raise --max-credits, then ${RESUBMIT}.`
    case 'capacity_unavailable':
    case 'queue_expired':
      return `No sandbox became free in time; ${RESUBMIT}.`
    case 'approval_expired':
      return `Approve the run in the Teler app before it expires, then ${RESUBMIT}.`
    default:
      return undefined
  }
}

export function assertRunSucceeded(run: RunResponse): void {
  if (run.status === 'failed') {
    const need = limitNeed(run)
    throw new CommandError(
      'RUN_FAILED',
      need
        ? `Run ${run.id} ${need}\n${CONTACT_SALES}`
        : `Run ${run.id} failed${run.errorCode ? ` (${run.errorCode})` : ''}`,
      need ? undefined : failedRunHint(run)
    )
  }
  if (run.status === 'cancelled')
    throw new CommandError('RUN_CANCELLED', `Run ${run.id} was cancelled`)
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Watch aborted'))
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('Watch aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function watchRun(
  client: TelerApiClient,
  output: Output,
  selection: {
    id: string
    organizationId: string
    timeoutSeconds: number
    lastKnown?: RunResponse
  },
  dependencies: RunWatchDependencies = {}
): Promise<void> {
  const now = dependencies.now ?? Date.now
  const wait = dependencies.sleep ?? sleep
  const deadline = now() + selection.timeoutSeconds * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), selection.timeoutSeconds * 1000)
  let lastKnown = selection.lastKnown
  const timeout = () => {
    if (lastKnown) emitRunReceipt(output, lastKnown)
    return new CommandError(
      'TIMEOUT',
      `Waiting timed out; resume with teler run get ${selection.id} --org ${selection.organizationId}`
    )
  }
  try {
    for (;;) {
      if (controller.signal.aborted || now() >= deadline) throw timeout()
      const receipt = await client.json(
        runPath(selection.id, selection.organizationId),
        runResponseSchema,
        { signal: controller.signal }
      )
      if (receipt.id !== selection.id)
        throw new ApiError('Teler API returned a mismatched run receipt', 502)
      lastKnown = receipt
      if (isTerminalRun(lastKnown)) {
        emitRunReceipt(output, lastKnown)
        assertRunSucceeded(lastKnown)
        return
      }
      await wait(Math.min(1000, Math.max(0, deadline - now())), controller.signal)
    }
  } catch (error) {
    if (error instanceof CommandError) throw error
    if (controller.signal.aborted || now() >= deadline) throw timeout()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
