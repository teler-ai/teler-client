import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { resolveCliOrganizationId } from './chats'
import { assertNoFlags, parseLimit, takeFlag, takeOption } from './command-args'
import { emitJson } from './command-output'
import {
  codeFileIdSchema,
  codeRunIdSchema,
  codeRunSchema,
  fileDescriptorSchema,
  jobNameSchema,
  runQuoteSchema,
  savedCodeFileSchema,
  tariffSchema,
  type CodeRun,
} from './code-file-contract'
import { declarationFor, resolveBindings, takeDeclarationFlags } from './code-file-declaration'
import {
  codeRunListSchema,
  isJsonMedia,
  printableJson,
  parseJsonOutput,
  readOutput,
  saveOutput,
} from './code-run-output'
import { parseControlInput, parseControlJson } from './control-args'
import { dataOrganizationIdSchema } from './data-contract'
import { ApiError, CommandError, UsageError } from './errors'
import { creditNano, runSubmitInputSchema } from './run-contract'
import { readTaskFile } from './run-command'

export const CODE_FILE_ACTIONS = new Set(['save-code', 'run', 'result', 'runs', 'output'])
const RUNTIME_ID = 'python-sandbox-v1'
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
const keySchema = runSubmitInputSchema.shape.idempotencyKey
const creditsSchema = runSubmitInputSchema.shape.maximumCredits
const waitSchema = z.number().finite().positive().max(7200)

async function organizationOf(client: TelerApiClient, option: string | undefined) {
  return parseControlInput(
    dataOrganizationIdSchema,
    await resolveCliOrganizationId(client, option),
    'organization ID'
  )
}

/** The File's current version: its revision, and what a save of a new one must name. */
async function describe(client: TelerApiClient, organizationId: string, fileId: string) {
  const query = new URLSearchParams({ organizationId })
  const descriptor = await client.json(
    `/api/files/${fileId}/content-descriptor?${query}`,
    fileDescriptorSchema
  )
  if (descriptor.revisionId === null || descriptor.securityVersion === undefined)
    throw new CommandError('NOT_A_CODE_FILE', `${fileId} is not a saved code File`)
  return { ...descriptor, revisionId: descriptor.revisionId }
}

function destination(path: string) {
  const scope = path.startsWith('/personal/')
    ? 'personal'
    : path.startsWith('/organization/')
      ? 'organization'
      : null
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!scope || !name) throw new UsageError('--to must be a path in /personal/ or /organization/')
  return { kind: 'create', scope, path, name }
}

async function saveCode(client: TelerApiClient, output: Output, args: string[]) {
  const to = takeOption(args, '--to')
  const fileOption = takeOption(args, '--file')
  const schemaPath = takeOption(args, '--params-schema')
  const organizationOption = takeOption(args, '--org')
  const flags = takeDeclarationFlags(args)
  assertNoFlags(args)
  if (
    args.length !== 1 ||
    Boolean(to) === Boolean(fileOption) ||
    flags.outputs.length > 0 ||
    flags.parameters !== undefined ||
    flags.alertRule !== undefined
  )
    throw new UsageError(
      'Usage: teler files save-code <local.py> (--to <path> | --file <file-id>) [--input <name>=<ref>]... [--params-schema <schema.json>]'
    )
  const code = await readTaskFile(args[0] ?? '', 'The code file')
  const inputSchema =
    schemaPath === undefined
      ? { type: 'object' }
      : parseControlJson(await readTaskFile(schemaPath, '--params-schema'), '--params-schema')
  const organizationId = await organizationOf(client, organizationOption)
  const fileId = fileOption && parseControlInput(codeFileIdSchema, fileOption, 'File ID')
  const bindings = await resolveBindings(client, organizationId, flags)
  const current = fileId ? await describe(client, organizationId, fileId) : null
  const query = new URLSearchParams({ organizationId })
  const saved = await client.json(`/api/files/save-content?${query}`, savedCodeFileSchema, {
    method: 'POST',
    body: JSON.stringify({
      retryKey: crypto.randomUUID(),
      destination: current
        ? {
            kind: 'revise',
            fileId,
            expectedVersion: current.version,
            expectedSecurityVersion: current.securityVersion,
          }
        : destination(to ?? ''),
      contract: {
        contractVersion: 1,
        kind: 'source',
        encoding: 'utf-8',
        language: 'python',
        execution: {
          entrypoint: '__main__',
          runtimeId: RUNTIME_ID,
          dependencyRevisionIds: [],
          inputSchema,
          outputSchema: {},
          bindingSourceIds: bindings.map((binding) => binding.sourceId),
        },
      },
      source: { text: code },
    }),
  })
  if (output.json) emitJson(output, { ...saved, bindings })
  else output.write(`Saved ${saved.fileId} version ${saved.version} (${saved.revisionId})\n`)
}

/** The server's run key: the CLI key, hashed into the characters a code run accepts. */
function runKey(key: string): string {
  return createHash('sha256').update(`teler-files-run:${key}`).digest('hex')
}

/** Each required output: a JSON value, or what a binary one is (save it with `files output`). */
async function readOutputs(client: TelerApiClient, organizationId: string, run: CodeRun) {
  const outputs: Record<string, unknown> = {}
  const lines: string[] = []
  for (const slot of run.requiredSlots) {
    const { mediaType, bytes } = await readOutput(client, organizationId, run.id, slot)
    if (isJsonMedia(mediaType)) {
      outputs[slot] = parseJsonOutput(bytes)
      lines.push(`output\t${slot}\t${printableJson(outputs[slot])}`)
    } else {
      outputs[slot] = { mediaType, byteLength: bytes.byteLength }
      lines.push(
        `output\t${slot}\tbinary, ${bytes.byteLength} bytes (teler files output ${run.id} ${slot} --output <file>)`
      )
    }
  }
  return { outputs, lines }
}

/** Prints a run and its outputs; a failed or cancelled one fails the command when `strict`. */
async function emitRun(
  client: TelerApiClient,
  output: Output,
  organizationId: string,
  run: CodeRun,
  strict = true
): Promise<void> {
  const { outputs, lines } =
    run.status === 'succeeded'
      ? await readOutputs(client, organizationId, run)
      : { outputs: {}, lines: [] }
  if (output.json) emitJson(output, { ...run, outputs })
  else {
    output.write(`${run.id}\t${run.status}${run.stopReason ? `\t${run.stopReason}` : ''}\n`)
    for (const line of lines) output.write(`${line}\n`)
  }
  if (!strict) return
  if (run.status === 'failed')
    throw new CommandError(
      'RUN_FAILED',
      `Run ${run.id} failed${run.stopReason ? ` (${run.stopReason})` : ''}`,
      run.stopReason === 'execution_failed'
        ? 'A saved File run does not return its traceback: run the same code with `teler run python` to see the error, save the fix with `teler files save-code --file <file-id>`, then run it again with a new --idempotency-key.'
        : undefined
    )
  if (run.status === 'cancelled')
    throw new CommandError('RUN_CANCELLED', `Run ${run.id} was cancelled`)
}

async function waitForRun(
  client: TelerApiClient,
  organizationId: string,
  run: CodeRun,
  timeoutSeconds: number
): Promise<CodeRun> {
  const deadline = Date.now() + timeoutSeconds * 1000
  const query = new URLSearchParams({ organizationId })
  let current = run
  while (!TERMINAL.has(current.status)) {
    if (Date.now() >= deadline)
      throw new CommandError(
        'TIMEOUT',
        `Run ${run.id} is still ${current.status}`,
        `Read it later with \`teler files result ${run.id} --wait\`; it keeps running.`
      )
    await new Promise((resolve) => setTimeout(resolve, 2000))
    current = await client.json(`/api/saved-code-runs/${run.id}?${query}`, codeRunSchema)
  }
  return current
}

function takeWait(args: string[]): number | undefined {
  const wait = takeFlag(args, '--wait')
  const timeout = takeOption(args, '--timeout')
  if (!wait && timeout !== undefined) throw new UsageError('--timeout requires --wait')
  if (!wait) return undefined
  return parseControlInput(waitSchema, timeout === undefined ? 1800 : Number(timeout), '--timeout')
}

async function runNow(client: TelerApiClient, output: Output, args: string[]) {
  const organizationOption = takeOption(args, '--org')
  const maximumCredits = takeOption(args, '--max-credits')
  const key = takeOption(args, '--idempotency-key')
  const waitSeconds = takeWait(args)
  const flags = takeDeclarationFlags(args)
  assertNoFlags(args)
  if (args.length !== 1)
    throw new UsageError(
      'Usage: teler files run <file-id> --max-credits <amount> --idempotency-key <key> [--output <slot>]...'
    )
  const fileId = parseControlInput(codeFileIdSchema, args[0], 'File ID')
  const credits = parseControlInput(creditsSchema, maximumCredits, '--max-credits')
  const idempotencyKey = parseControlInput(keySchema, key, '--idempotency-key')
  const organizationId = await organizationOf(client, organizationOption)
  const query = new URLSearchParams({ organizationId })
  const { revisionId } = await describe(client, organizationId, fileId)
  const declaration = await declarationFor(client, organizationId, fileId, flags, 'runNow')
  const { tariffVersion } = await client.json(`/api/saved-code-runs/tariff?${query}`, tariffSchema)
  // The quote names the run's project, so it is checked as the run will be.
  const quote = await client.json(`/api/saved-code-runs/preflight?${query}`, runQuoteSchema, {
    method: 'POST',
    body: JSON.stringify({
      maximumCredits: credits,
      tariffVersion,
      ...(declaration.projectId ? { projectId: declaration.projectId } : {}),
    }),
  })
  if (
    quote.payer.organizationId !== organizationId ||
    creditNano(quote.maximumCredits) !== creditNano(credits)
  )
    throw new ApiError('Teler API returned a mismatched quote', 502)
  const occurrenceAt = new Date().toISOString()
  const accepted = await client.json(`/api/saved-code-runs?${query}`, codeRunSchema, {
    method: 'POST',
    body: JSON.stringify({
      idempotencyKey: runKey(idempotencyKey),
      sourceFileId: fileId,
      sourceRevisionId: revisionId,
      purpose: 'production',
      ...declaration,
      occurrenceAt,
      maximumCredits: quote.maximumCredits,
      tariffVersion: quote.tariffVersion,
      approvedFunding: quote.funding,
      approvedPayer: quote.payer,
      approvedReservedMemoryMiB: quote.reservedMemoryMiB,
    }),
  })
  if (accepted.sourceFileId !== fileId || accepted.sourceRevisionId !== revisionId)
    throw new ApiError('Teler API returned a mismatched run receipt', 502)
  if (waitSeconds === undefined || TERMINAL.has(accepted.status))
    return await emitRun(client, output, organizationId, accepted)
  if (output.json) emitJson(output, { ...accepted, outputs: {} })
  else output.write(`${accepted.id}\t${accepted.status}\n`)
  await emitRun(
    client,
    output,
    organizationId,
    await waitForRun(client, organizationId, accepted, waitSeconds)
  )
}

async function result(client: TelerApiClient, output: Output, args: string[]) {
  const organizationOption = takeOption(args, '--org')
  const waitSeconds = takeWait(args)
  assertNoFlags(args)
  if (args.length !== 1) throw new UsageError('Usage: teler files result <run-id> [--wait]')
  const runId = parseControlInput(codeRunIdSchema, args[0], 'run ID')
  const organizationId = await organizationOf(client, organizationOption)
  const query = new URLSearchParams({ organizationId })
  let run = await client.json(`/api/saved-code-runs/${runId}?${query}`, codeRunSchema)
  if (run.id !== runId) throw new ApiError('Teler API returned a mismatched run receipt', 502)
  if (waitSeconds !== undefined) run = await waitForRun(client, organizationId, run, waitSeconds)
  // Reading a failed run succeeds; waiting for one that fails does not.
  await emitRun(client, output, organizationId, run, waitSeconds !== undefined)
}

async function listRuns(client: TelerApiClient, output: Output, args: string[]) {
  const organizationOption = takeOption(args, '--org')
  const limit = parseLimit(takeOption(args, '--limit'), 20, 100)
  const cursor = takeOption(args, '--cursor')
  assertNoFlags(args)
  if (args.length) throw new UsageError('Usage: teler files runs [--limit <n>] [--cursor <cursor>]')
  const organizationId = await organizationOf(client, organizationOption)
  const query = new URLSearchParams({ organizationId, limit: String(limit) })
  if (cursor) query.set('cursor', cursor)
  const page = await client.json(`/api/saved-code-runs?${query}`, codeRunListSchema)
  if (output.json) return emitJson(output, page)
  if (!page.items.length) return output.write('No code runs yet.\n')
  for (const run of page.items)
    output.write(
      `${run.id}\t${run.status}\t${run.sourceFileId}\t${run.occurrenceAt ?? run.createdAt}\n`
    )
  if (page.nextCursor) output.write(`More: teler files runs --cursor ${page.nextCursor}\n`)
}

async function downloadOutput(client: TelerApiClient, output: Output, args: string[]) {
  const organizationOption = takeOption(args, '--org')
  const destination = takeOption(args, '--output')
  assertNoFlags(args)
  if (args.length !== 2)
    throw new UsageError('Usage: teler files output <run-id> <slot> [--output <file>]')
  const runId = parseControlInput(codeRunIdSchema, args[0], 'run ID')
  const slot = parseControlInput(jobNameSchema, args[1], 'output slot')
  const organizationId = await organizationOf(client, organizationOption)
  if (destination !== undefined) {
    const savedTo = await saveOutput(client, organizationId, runId, slot, destination)
    if (output.json) emitJson(output, { runId, slot, savedTo })
    else output.write(`Saved ${slot} to ${savedTo}\n`)
    return
  }
  const { mediaType, bytes } = await readOutput(client, organizationId, runId, slot)
  if (!isJsonMedia(mediaType))
    throw new UsageError(
      `${slot} is binary (${bytes.byteLength} bytes); save it with --output <file>`
    )
  const value = parseJsonOutput(bytes)
  if (output.json) emitJson(output, { runId, slot, value })
  else output.write(`${JSON.stringify(value)}\n`)
}

/** `teler files save-code|run|result|runs|output`: code saved as a File, and its runs. */
export async function runCodeFileCommand(
  client: TelerApiClient,
  output: Output,
  action: string,
  args: string[]
): Promise<void> {
  if (action === 'save-code') return await saveCode(client, output, args)
  if (action === 'run') return await runNow(client, output, args)
  if (action === 'runs') return await listRuns(client, output, args)
  if (action === 'output') return await downloadOutput(client, output, args)
  return await result(client, output, args)
}
