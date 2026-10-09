import { Buffer } from 'node:buffer'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { resolveCliOrganizationId } from './chats'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import { parseControlInput } from './control-args'
import { dataOrganizationIdSchema } from './data-contract'
import { ApiError, UsageError } from './errors'
import {
  creditNano,
  runPreflightResponseSchema,
  runResponseSchema,
  runSelectionInputSchema,
  runSubmitInputSchema,
} from './run-contract'
import {
  assertRunSucceeded,
  emitRunReceipt,
  isTerminalRun,
  runPath,
  watchRun,
  type RunWatchDependencies,
} from './run-watch'

const MAX_FILE_BYTES = 256 * 1024
const watchTimeoutSchema = z.number().finite().positive().max(3600)
const optionsSchema = runSubmitInputSchema.omit({ task: true }).extend({
  file: z.string().min(1),
  rowLimit: z.number().int().min(1).max(1000).default(100),
  watchTimeout: watchTimeoutSchema.default(180),
})

async function readTaskFile(path: string): Promise<string> {
  try {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.size > MAX_FILE_BYTES) throw new Error('Invalid file')
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
      let count = 0
      while (count < buffer.length) {
        const result = await handle.read(buffer, count, buffer.length - count, null)
        if (result.bytesRead === 0) break
        count += result.bytesRead
      }
      const after = await handle.stat()
      if (count > MAX_FILE_BYTES || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw new Error('Invalid file')
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))
    } finally {
      await handle.close()
    }
  } catch {
    throw new UsageError('--file must be a readable, stable UTF-8 regular file of at most 256 KiB')
  }
}

async function submitRun(
  kind: 'python' | 'sql' | 'artifact',
  args: string[],
  client: TelerApiClient,
  output: Output,
  dependencies: RunWatchDependencies
) {
  const file = takeOption(args, '--file')
  const projectId = takeOption(args, '--project')
  const organizationId = takeOption(args, '--org')
  const chatId = takeOption(args, '--chat')
  const maximumCredits = takeOption(args, '--max-credits')
  const idempotencyKey = takeOption(args, '--idempotency-key')
  const executionTimeout = takeOption(args, '--execution-timeout')
  const watchTimeout = takeOption(args, '--timeout')
  const rowLimit = kind === 'sql' ? takeOption(args, '--row-limit') : undefined
  const wait = takeFlag(args, '--wait')
  assertNoFlags(args)
  if (args.length || (!wait && watchTimeout !== undefined))
    throw new UsageError('Unexpected run argument; --timeout requires --wait')
  const options = parseControlInput(
    optionsSchema,
    {
      file,
      projectId,
      organizationId,
      chatId,
      maximumCredits,
      idempotencyKey,
      timeoutSeconds: executionTimeout === undefined ? undefined : Number(executionTimeout),
      rowLimit: rowLimit === undefined ? undefined : Number(rowLimit),
      watchTimeout: watchTimeout === undefined ? undefined : Number(watchTimeout),
    },
    'run options'
  )
  const source = await readTaskFile(options.file)
  let artifact: unknown
  if (kind === 'artifact') {
    try {
      artifact = JSON.parse(source) as unknown
    } catch {
      throw new UsageError('--file must contain a valid artifact JSON object')
    }
  }
  const task =
    kind === 'python'
      ? { kind, code: source }
      : kind === 'sql'
        ? { kind, sql: source, rowLimit: options.rowLimit }
        : { kind, artifact }
  const input = parseControlInput(
    runSubmitInputSchema,
    {
      organizationId: options.organizationId,
      projectId: options.projectId,
      chatId: options.chatId,
      maximumCredits: options.maximumCredits,
      idempotencyKey: options.idempotencyKey,
      timeoutSeconds: options.timeoutSeconds,
      task,
    },
    'run task'
  )
  if (Buffer.byteLength(JSON.stringify(input.task), 'utf8') > MAX_FILE_BYTES)
    throw new UsageError('Run task exceeds 256 KiB')
  const org = parseControlInput(
    dataOrganizationIdSchema,
    await resolveCliOrganizationId(client, input.organizationId),
    'organization ID'
  )
  const { organizationId: _organizationId, ...intent } = input
  const query = new URLSearchParams({ organizationId: org })
  const preflight = await client.json(`/api/runs/preflight?${query}`, runPreflightResponseSchema, {
    method: 'POST',
    body: JSON.stringify(intent),
  })
  let run
  if (preflight.run !== null) run = preflight.run
  else {
    if (
      preflight.payer.organizationId !== org ||
      creditNano(preflight.maximumCredits) !== creditNano(input.maximumCredits)
    )
      throw new ApiError('Teler API returned a mismatched quote', 502)
    run = await client.json(`/api/runs?${query}`, runResponseSchema, {
      method: 'POST',
      body: JSON.stringify({
        ...intent,
        maximumCredits: preflight.maximumCredits,
        tariffVersion: preflight.tariffVersion,
        approvedPayer: preflight.payer,
        approvedFunding: preflight.funding,
        approvedReservedMemoryMiB: preflight.reservedMemoryMiB,
      }),
    })
  }
  if (
    run.idempotencyKey !== intent.idempotencyKey ||
    run.projectId !== intent.projectId ||
    run.language !== intent.task.kind ||
    (intent.chatId !== undefined && run.chatId !== intent.chatId) ||
    creditNano(run.maximumCredits) !== creditNano(intent.maximumCredits)
  )
    throw new ApiError('Teler API returned a mismatched run receipt', 502)
  emitRunReceipt(output, run)
  if (isTerminalRun(run)) return assertRunSucceeded(run)
  if (wait)
    await watchRun(
      client,
      output,
      { id: run.id, organizationId: org, timeoutSeconds: options.watchTimeout, lastKnown: run },
      dependencies
    )
}

export async function runAnalysisCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  client: TelerApiClient,
  output: Output,
  dependencies: RunWatchDependencies = {}
): Promise<boolean> {
  const kind =
    group === 'run' && action === 'python'
      ? 'python'
      : group === 'data' && action === 'query'
        ? 'sql'
        : group === 'artifact' && action === 'create'
          ? 'artifact'
          : undefined
  if (kind) {
    await submitRun(kind, args, client, output, dependencies)
    return true
  }
  if (group !== 'run') return false
  if (!['get', 'wait', 'cancel'].includes(action ?? ''))
    throw new UsageError('Unknown run command. Use python, get, wait or cancel.')
  const organizationId = takeOption(args, '--org')
  const timeout = action === 'wait' ? takeOption(args, '--timeout') : undefined
  assertNoFlags(args)
  if (args.length !== 1) throw new UsageError('A single run ID is required')
  const selection = parseControlInput(
    runSelectionInputSchema,
    { id: args[0], organizationId },
    'run selection'
  )
  const timeoutSeconds = parseControlInput(
    watchTimeoutSchema,
    timeout === undefined ? 180 : Number(timeout),
    'wait timeout'
  )
  const org = parseControlInput(
    dataOrganizationIdSchema,
    await resolveCliOrganizationId(client, selection.organizationId),
    'organization ID'
  )
  if (action === 'wait')
    await watchRun(
      client,
      output,
      { id: selection.id, organizationId: org, timeoutSeconds },
      dependencies
    )
  else {
    const run = await client.json(
      runPath(selection.id, org, action === 'cancel'),
      runResponseSchema,
      {
        method: action === 'cancel' ? 'POST' : 'GET',
        ...(action === 'cancel' ? { body: '{}' } : {}),
      }
    )
    if (run.id !== selection.id)
      throw new ApiError('Teler API returned a mismatched run receipt', 502)
    emitRunReceipt(output, run)
  }
  return true
}
