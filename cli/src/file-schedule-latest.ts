import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { emitJson } from './command-output'
import { codeRunSchema, fileScheduleRunsSchema, type FileSchedule } from './code-file-contract'
import {
  describeOutput,
  isJsonMedia,
  latestOccurrenceSchema,
  MAX_READ_BYTES,
  newestRunId,
  parseJsonOutput,
  readOutput,
  saveOutput,
} from './code-run-output'
import { ApiError, CommandError, UsageError } from './errors'

export interface LatestOptions {
  slot?: string
  destination?: string
}

/**
 * The latest occurrence of a File schedule's run stream: the newest occurrence that started a
 * run names the stream; Teler answers its latest run, succeeded or not, and its typed outputs.
 */
export async function showLatest(
  client: TelerApiClient,
  output: Output,
  schedule: FileSchedule,
  options: LatestOptions
): Promise<void> {
  const { runs } = await client.json(`/api/schedule/${schedule.id}/history`, fileScheduleRunsSchema)
  const runId = newestRunId(runs)
  if (!runId)
    throw new CommandError(
      'NO_RUN_YET',
      `${schedule.id} has not started a run yet`,
      'It runs at its next occurrence once its spend is approved; `teler files run <file-id>` runs the File now.'
    )
  const query = new URLSearchParams({ organizationId: schedule.organizationId })
  const run = await client.json(`/api/saved-code-runs/${runId}?${query}`, codeRunSchema)
  if (run.id !== runId || !run.streamSha256)
    throw new ApiError('Teler API returned a mismatched run receipt', 502)
  const latest = await client.json(
    `/api/saved-code-runs/streams/${run.streamSha256}/latest?${query}`,
    latestOccurrenceSchema
  )
  const outputs = (latest.outputs ?? []).filter(
    (item) => options.slot === undefined || item.slot === options.slot
  )
  if (options.slot !== undefined && latest.outputs && outputs.length === 0)
    throw new CommandError('NO_SUCH_OUTPUT', `The latest run has no output named ${options.slot}`)
  let savedTo: string | undefined
  if (options.destination !== undefined) {
    if (!latest.outputs)
      throw new CommandError(
        'NO_OUTPUT_YET',
        `The latest run ${latest.run.id} is ${latest.run.status}; it has no outputs to save`
      )
    if (outputs.length !== 1) throw new UsageError('Choose the output to save with --slot <slot>')
    const [only] = outputs
    savedTo = await saveOutput(
      client,
      schedule.organizationId,
      latest.run.id,
      only?.slot ?? '',
      options.destination
    )
  }
  if (output.json)
    return emitJson(output, {
      ...latest,
      outputs: latest.outputs ? outputs : null,
      ...(savedTo ? { savedTo } : {}),
    })
  const { run: latestRun, publishedAt } = latest
  output.write(
    `${latestRun.id}\t${latestRun.status}${latestRun.stopReason ? `\t${latestRun.stopReason}` : ''}` +
      `\toccurrence ${latestRun.occurrenceAt ?? latestRun.createdAt}` +
      `${publishedAt ? `\tpublished ${publishedAt}` : ''}\n`
  )
  for (const item of outputs) {
    // A JSON or dataset output is read to count its rows; a model's contract says enough.
    let value: unknown
    // One too large to read here is described from its contract alone.
    if (
      (item.contract.kind === 'json' || item.contract.kind === 'dataset') &&
      item.byteLength <= MAX_READ_BYTES
    ) {
      const read = await readOutput(client, schedule.organizationId, latestRun.id, item.slot)
      if (isJsonMedia(read.mediaType)) value = parseJsonOutput(read.bytes)
    }
    output.write(`output\t${item.slot}\t${describeOutput(item.contract, value)}\n`)
  }
  if (savedTo) output.write(`Saved to ${savedTo}\n`)
}
