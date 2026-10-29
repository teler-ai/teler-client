import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { emitJson } from './command-output'
import { ApiError, CommandError } from './errors'
import { runResponseSchema, type RunResponse } from './run-contract'
import { approvalHint, approvalUrl, leftOutHint } from './run-capabilities'

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

export function emitRunReceipt(output: Output, run: RunResponse, origin: URL): void {
  const url = approvalUrl(run, origin)
  if (output.json) {
    const need = limitNeed(run)
    if (url) return emitJson(output, { ...run, approvalUrl: url, hint: approvalHint(run, origin) })
    return emitJson(output, need ? { ...run, hint: `This request ${need} ${CONTACT_SALES}` } : run)
  }
  output.write(
    `${run.id}\t${run.status}\t${run.language}\tcharged=${run.chargedCredits ?? 'pending'}\n`
  )
  if (url && run.approval)
    output.write(
      `Approve ${run.approval.asks.map((ask) => ask.capability).join(', ')} in the Teler app: ${url} (by ${run.approval.expiresAt})\n`
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

/** What the CLI knows about a run beyond its receipt, for the next step it names. */
export interface RunContext {
  /** The run waited for the person's approval at some point. */
  awaitedApproval?: boolean
  /** What a run without --capabilities left out because Agent Access asks about it first. */
  leftOut?: readonly string[]
}

/** What to change before trying again, by the run's error code. */
function failedRunHint(run: RunResponse, context: RunContext): string | undefined {
  switch (run.errorCode) {
    case 'execution_failed': {
      const fix = run.errorDetail
        ? `Fix the code using the traceback in errorDetail, then ${RESUBMIT}.`
        : `Fix the code, then ${RESUBMIT}.`
      const leftOut = leftOutHint(context.leftOut ?? [])
      return leftOut ? `${fix} ${leftOut}` : fix
    }
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

export function assertRunSucceeded(run: RunResponse, context: RunContext = {}): void {
  if (run.status === 'failed') {
    const need = limitNeed(run)
    throw new CommandError(
      'RUN_FAILED',
      need
        ? `Run ${run.id} ${need}\n${CONTACT_SALES}`
        : `Run ${run.id} failed${run.errorCode ? ` (${run.errorCode})` : ''}`,
      need ? undefined : failedRunHint(run, context)
    )
  }
  if (run.status === 'cancelled')
    throw new CommandError(
      'RUN_CANCELLED',
      `Run ${run.id} was cancelled`,
      context.awaitedApproval
        ? 'It ended while it waited for approval in the Teler app: the person denied it, the ' +
            'request expired, their Agent Access changed, or the run was cancelled. Ask the ' +
            `person before you ${RESUBMIT}.`
        : undefined
    )
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
    /** More waiting, granted once, when the run turns out to wait for the person's approval. */
    approvalSeconds?: number
    leftOut?: readonly string[]
  },
  dependencies: RunWatchDependencies = {}
): Promise<void> {
  const now = dependencies.now ?? Date.now
  const wait = dependencies.sleep ?? sleep
  let deadline = now() + selection.timeoutSeconds * 1000
  const controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), selection.timeoutSeconds * 1000)
  let lastKnown = selection.lastKnown
  const context: RunContext = { leftOut: selection.leftOut }
  const awaiting = (run: RunResponse | undefined) => {
    if (run?.status !== 'needs_approval') return false
    if (!context.awaitedApproval && selection.approvalSeconds) {
      deadline += selection.approvalSeconds * 1000
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), Math.max(0, deadline - now()))
    }
    context.awaitedApproval = true
    return true
  }
  awaiting(lastKnown)
  const timeout = () => {
    if (lastKnown) emitRunReceipt(output, lastKnown, client.baseUrl)
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
        emitRunReceipt(output, lastKnown, client.baseUrl)
        assertRunSucceeded(lastKnown, context)
        return
      }
      // A person answers in minutes, not seconds: read less often while the run waits for them.
      const pause = awaiting(lastKnown) ? 5000 : 1000
      await wait(Math.min(pause, Math.max(0, deadline - now())), controller.signal)
    }
  } catch (error) {
    if (error instanceof CommandError) throw error
    if (controller.signal.aborted || now() >= deadline) throw timeout()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
