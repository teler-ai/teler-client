import { z } from 'zod'
import type { TelerApiClient } from './api'
import { downloadArtifact } from './artifact-command'
import { codeRunSchema, jobNameSchema, type CodeRun } from './code-file-contract'
import { ApiError } from './errors'

const MAX_READ_BYTES = 32 * 1024 * 1024
const columnSchema = z.object({ name: z.string(), type: z.string() })
const columnsSchema = z.array(columnSchema)

/** What an output slot holds, as its contract declares it. Unknown kinds keep their fields. */
export const outputContractSchema = z.looseObject({
  kind: z.enum(['json', 'dataset', 'model', 'binary', 'source']),
})
const datasetContractSchema = z.object({
  dataset: z.object({
    columns: columnsSchema,
    time: z
      .object({
        column: z.string(),
        semantics: z.string(),
        coverage: z.object({ start: z.string().nullable(), end: z.string().nullable() }),
      })
      .nullable(),
  }),
})
const modelContractSchema = z.object({
  model: z.object({
    framework: z.string(),
    frameworkVersion: z.string(),
    features: columnsSchema,
    outputSchema: z.unknown(),
  }),
})

/** The latest occurrence of a run's stream: its run and, once it succeeded, its outputs. */
export const latestOccurrenceSchema = z.looseObject({
  streamSha256: z.string().regex(/^[0-9a-f]{64}$/),
  run: codeRunSchema,
  publishedAt: z.string().nullable(),
  outputs: z
    .array(
      z.looseObject({
        slot: jobNameSchema,
        contract: outputContractSchema,
        byteLength: z.number().int().nonnegative(),
        mediaType: z.string(),
      })
    )
    .nullable(),
})
export type LatestOccurrence = z.infer<typeof latestOccurrenceSchema>
type OutputContract = z.infer<typeof outputContractSchema>

export const codeRunListSchema = z.object({
  items: z.array(codeRunSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
})

export function outputPath(organizationId: string, runId: string, slot: string): string {
  return `/api/saved-code-runs/${runId}/outputs/${slot}?${new URLSearchParams({ organizationId })}`
}

export function isJsonMedia(mediaType: string | null): boolean {
  return (mediaType ?? '').split(';')[0]?.trim() === 'application/json'
}

/** One output's bytes and media type, bounded like a download. */
export async function readOutput(
  client: TelerApiClient,
  organizationId: string,
  runId: string,
  slot: string
): Promise<{ mediaType: string | null; bytes: Uint8Array }> {
  const response = await client.request(outputPath(organizationId, runId, slot))
  const length = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(length) && length > MAX_READ_BYTES)
    throw new ApiError('Output exceeds 32 MiB; save it with --output <file>', 413)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_READ_BYTES)
    throw new ApiError('Output exceeds 32 MiB; save it with --output <file>', 413)
  return { mediaType: response.headers.get('Content-Type'), bytes }
}

export function parseJsonOutput(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new ApiError('Teler API returned an invalid output', 502)
  }
}

/** Saves one output to a new local file; an existing file is never replaced. */
export function saveOutput(
  client: TelerApiClient,
  organizationId: string,
  runId: string,
  slot: string,
  destination: string
): Promise<string> {
  return downloadArtifact(client, outputPath(organizationId, runId, slot), destination, 'Output')
}

const columnsWords = (columns: z.infer<typeof columnsSchema>) =>
  columns.map((column) => `${column.name}:${column.type}`).join(', ')

/** The earliest and latest value of a time column, as rows hold them. */
function coverageOf(rows: unknown, column: string): string | null {
  if (!Array.isArray(rows)) return null
  const values = rows
    .map((row: unknown) =>
      row !== null && typeof row === 'object' ? Reflect.get(row, column) : undefined
    )
    .filter((value): value is string => typeof value === 'string')
    .sort()
  return values.length ? `${values[0]}..${values.at(-1)}` : null
}

/**
 * A short line for one output: a dataset's rows, columns and time coverage; a model's framework,
 * features and output; a JSON value's shape. `value` is the output when it was read.
 */
export function describeOutput(contract: OutputContract | null, value?: unknown): string {
  return describe(contract, value).replace(CONTROL, '?')
}

// Output text is the member's own data; terminal control characters are still never printed.
// eslint-disable-next-line no-control-regex -- matching control text is the point
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g

function describe(contract: OutputContract | null, value?: unknown): string {
  const dataset = datasetContractSchema.safeParse(contract)
  if (contract?.kind === 'dataset' && dataset.success) {
    const { columns, time } = dataset.data.dataset
    const rows = Array.isArray(value) ? `${value.length} rows; ` : ''
    const declared =
      time && (time.coverage.start || time.coverage.end)
        ? `${time.coverage.start ?? '…'}..${time.coverage.end ?? '…'}`
        : null
    const coverage = time ? (declared ?? coverageOf(value, time.column)) : null
    return `dataset: ${rows}columns ${columnsWords(columns)}${
      time ? `; time ${time.column} (${time.semantics})${coverage ? ` ${coverage}` : ''}` : ''
    }`
  }
  const model = modelContractSchema.safeParse(contract)
  if (contract?.kind === 'model' && model.success) {
    const { framework, frameworkVersion, features, outputSchema } = model.data.model
    const output =
      outputSchema !== null && typeof outputSchema === 'object'
        ? Reflect.get(outputSchema, 'type')
        : undefined
    return `model: ${framework} ${frameworkVersion}; features ${columnsWords(features)}${
      typeof output === 'string' ? `; output ${output}` : ''
    }`
  }
  if (Array.isArray(value)) {
    const first: unknown = value[0]
    const keys = first !== null && typeof first === 'object' ? Object.keys(first) : []
    return `json: ${value.length} items${keys.length ? `; keys ${keys.join(', ')}` : ''}`
  }
  if (value !== null && typeof value === 'object')
    return `json: keys ${Object.keys(value).join(', ')}`
  if (value !== undefined) return `json: ${JSON.stringify(value)}`
  return contract ? `${contract.kind}` : 'output'
}

/** The run of the newest occurrence that started one; null before any did. */
export function newestRunId(runs: readonly { savedCodeRunId: string | null }[]): string | null {
  return runs.find((run) => run.savedCodeRunId !== null)?.savedCodeRunId ?? null
}

export type { CodeRun }
