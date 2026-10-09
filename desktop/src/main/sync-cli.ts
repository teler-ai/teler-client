import { z } from 'zod'
import type { DesktopErrorCode, FolderInput } from '../shared/desktop-api'

/**
 * Typed client for the bundled `teler` CLI. The desktop app drives sync only
 * through the CLI's stable `--json` surface; it never reads the sync database.
 */
export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
  /** The command was stopped at its time limit. */
  timedOut?: boolean
}

export interface CliRunner {
  run(args: readonly string[], options?: { timeoutMs?: number }): Promise<CliResult>
}

const registrationSchema = z.object({
  id: z.string(),
  localPath: z.string(),
  origin: z.string(),
  accountId: z.string(),
  organizationId: z.string(),
  destination: z.string(),
  projectId: z.string().optional(),
  paused: z.boolean(),
  status: z.string(),
  checkedAt: z.number().nullable(),
})
const fileSchema = z.object({
  relativePath: z.string(),
  status: z.string(),
  retryAt: z.number().optional(),
  error: z.string().nullable().optional(),
  hash: z.string().nullable().optional(),
  revision: z.string().nullable().optional(),
  documentIds: z.array(z.string()).optional(),
})
const throttleSchema = z.number().nullable().optional()
const listSchema = z.object({
  daemonRunning: z.boolean(),
  throttledUntil: throttleSchema,
  registrations: z.array(registrationSchema),
})
const statusSchema = z.object({
  daemonRunning: z.boolean(),
  throttledUntil: throttleSchema,
  registrations: z.array(registrationSchema.extend({ files: z.array(fileSchema) })),
})
const previewSchema = z.object({
  localPath: z.string(),
  destination: z.string(),
  files: z.array(z.object({ relativePath: z.string(), bytes: z.number() })),
  skipped: z.array(z.object({ relativePath: z.string(), reason: z.string() })),
})

export type SyncRegistration = z.infer<typeof registrationSchema>
export type SyncList = z.infer<typeof listSchema>
export type SyncStatus = z.infer<typeof statusSchema>
export type SyncPreview = z.infer<typeof previewSchema>

export class SyncCliError extends Error {
  constructor(readonly code: DesktopErrorCode) {
    super(`Teler sync command failed: ${code}`)
    this.name = 'SyncCliError'
  }
}

// The CLI prints fixed `teler: <message>` errors; map them to stable codes so
// no raw command output reaches the UI.
const ERROR_PATTERNS: Array<[RegExp, DesktopErrorCode]> = [
  [/Not authenticated|authentication required|request failed \(40[13]\b/i, 'not-connected'],
  [/No active organization/i, 'no-organization'],
  [/must be a local directory|no such file|ENOENT|not a directory/i, 'invalid-folder'],
  [/destination must be inside/i, 'invalid-destination'],
  [/could not be completed|request failed \(5\d\d\b|timed out/i, 'network'],
]

export const PREVIEW_TIMEOUT_MS = 10 * 60_000

export function errorCodeFor(stderr: string): DesktopErrorCode {
  return ERROR_PATTERNS.find(([pattern]) => pattern.test(stderr))?.[1] ?? 'sync-failed'
}

export class SyncCli {
  constructor(private readonly runner: CliRunner) {}

  private async json<T>(args: readonly string[], schema: z.ZodType<T>, timeoutMs = 60_000) {
    const result = await this.runner.run([...args, '--json'], { timeoutMs })
    if (result.timedOut) throw new SyncCliError('timeout')
    if (result.exitCode !== 0) throw new SyncCliError(errorCodeFor(result.stderr))
    const parsed = schema.safeParse(JSON.parse(result.stdout.trim() || 'null') as unknown)
    if (!parsed.success) throw new SyncCliError('sync-failed')
    return parsed.data
  }

  list() {
    return this.json(['sync', 'list'], listSchema)
  }

  status() {
    return this.json(['sync', 'status'], statusSchema)
  }

  /** Reads and hashes every candidate file, so large folders get a long limit. */
  preview(input: FolderInput) {
    return this.json(
      ['sync', input.localPath, '--to', input.destination, '--dry-run'],
      previewSchema,
      PREVIEW_TIMEOUT_MS
    )
  }

  register(input: FolderInput) {
    return this.json(
      [
        'sync',
        input.localPath,
        '--to',
        input.destination,
        ...(input.organizationId ? ['--org', input.organizationId] : []),
        ...(input.projectId ? ['--project', input.projectId] : []),
      ],
      registrationSchema
    )
  }

  async pause(id: string) {
    await this.json(['sync', 'pause', id], listSchema)
  }

  async resume(id: string) {
    await this.json(['sync', 'resume', id], listSchema)
  }

  /** Tries the folder's waiting files on the daemon's next pass. */
  async retry(id: string) {
    await this.json(['sync', 'retry', id], listSchema)
  }

  async remove(id: string) {
    await this.json(['sync', 'remove', id], listSchema)
  }

  /** Asks the daemon that holds the sync lease to stop and waits for its acknowledgement. */
  async stop() {
    await this.json(['sync', 'stop'], z.object({ stopped: z.literal(true) }), 30_000)
  }
}
