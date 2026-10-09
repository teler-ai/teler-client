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

export function emitRunReceipt(output: Output, run: RunResponse): void {
  if (output.json) return emitJson(output, run)
  output.write(
    `${run.id}\t${run.status}\t${run.language}\tcharged=${run.chargedCredits ?? 'pending'}\n`
  )
  if (!output.metadataOnly && run.output) output.write(`${run.output.replace(/\n$/, '')}\n`)
  for (const artifact of run.artifacts)
    output.write(`artifact\t${artifact.id}\t${artifact.slug}\t${artifact.type}\n`)
}

export function isTerminalRun(run: RunResponse): boolean {
  return ['completed', 'failed', 'cancelled'].includes(run.status)
}

export function assertRunSucceeded(run: RunResponse): void {
  if (run.status === 'failed')
    throw new CommandError(
      'RUN_FAILED',
      `Run ${run.id} failed${run.errorCode ? ` (${run.errorCode})` : ''}`
    )
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
