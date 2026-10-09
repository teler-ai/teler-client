import type { TelerApiClient } from './api'
import { assertNoFlags, parseLimit, takeFlag, takeOption, withTimeout } from './command-args'
import type { Output } from './chats'
import { UsageError } from './errors'
import { listUploads, showUploadStatus, uploadLocalFile, type UploadStatus } from './uploads'

const UPLOAD_STATUSES = new Set<UploadStatus>([
  'uploading',
  'queued',
  'processing',
  'completed',
  'partial_success',
  'failed',
])

export async function runUploadCommand(
  client: TelerApiClient,
  output: Output,
  args: string[]
): Promise<void> {
  const subject = args.shift()
  const organizationId = takeOption(args, '--org')
  if (subject === 'list') {
    const rawStatus = takeOption(args, '--status')
    if (rawStatus && !UPLOAD_STATUSES.has(rawStatus as UploadStatus)) {
      throw new UsageError('--status is not a valid upload status')
    }
    const limit = parseLimit(takeOption(args, '--limit'), 20, 100)
    assertNoFlags(args)
    if (args.length > 0) throw new UsageError('Usage: teler upload list')
    return await listUploads(client, output, {
      organizationId,
      status: rawStatus as UploadStatus | undefined,
      limit,
    })
  }
  if (subject === 'status') {
    if (organizationId) throw new UsageError('--org is not valid for upload status')
    const wait = takeFlag(args, '--wait')
    const timeout = takeOption(args, '--timeout')
    assertNoFlags(args)
    if (args.length !== 1) throw new UsageError('Usage: teler upload status <job-id>')
    return await withTimeout(timeout, (signal) =>
      showUploadStatus(client, output, args[0] ?? '', { wait, signal })
    )
  }
  const destinationPath = takeOption(args, '--to')
  const rawScope = takeOption(args, '--scope') ?? 'personal'
  const projectId = takeOption(args, '--project')
  const wait = takeFlag(args, '--wait')
  const timeout = takeOption(args, '--timeout')
  if (rawScope !== 'personal' && rawScope !== 'organization') {
    throw new UsageError('--scope must be personal or organization')
  }
  assertNoFlags(args)
  if (!subject || args.length > 0) throw new UsageError('Usage: teler upload <local-file>')
  return await withTimeout(timeout, (signal) =>
    uploadLocalFile(client, output, {
      filePath: subject,
      organizationId,
      destinationPath,
      scope: rawScope,
      projectId,
      wait,
      signal,
    })
  )
}
