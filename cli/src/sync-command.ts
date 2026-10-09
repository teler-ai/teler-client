import { lstat, realpath, unlink } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { FetchLike } from './api'
import { authStatus } from './auth'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import type { Output } from './chats'
import {
  createConfiguredCredentialStore,
  resolveCredential,
  type CredentialStore,
} from './credentials'
import { UsageError } from './errors'
import { runSyncWorker, startSyncDaemon, syncDirectory } from './sync-daemon'
import { scanFolder } from './sync-scan'
import { protectedSyncPaths } from './sync-paths'
import { SyncStore } from './sync-store'
import { resolveTelerUrl } from './url'

/** A Teler project TypeID; the server checks that the account can see it. */
const PROJECT_ID = /^prj_[0-9a-hjkmnp-tv-z]{26}$/

interface SyncCommandDeps {
  env: NodeJS.ProcessEnv
  store?: CredentialStore
  fetch?: FetchLike
}
export async function runSyncCommand(
  output: Output,
  action: string | undefined,
  args: string[],
  deps: SyncCommandDeps
) {
  const directory = syncDirectory(deps.env)
  if (action === 'stop') {
    assertNoFlags(args)
    if (args.length) throw new UsageError('Usage: teler sync stop')
    const store = new SyncStore(join(directory, 'sync.db'))
    try {
      const owner = store.requestStop()
      const deadline = Date.now() + 10_000
      while (owner && store.owns(owner) && Date.now() < deadline) await Bun.sleep(100)
      if (owner && store.owns(owner))
        throw new UsageError(
          'Sync stop requested; worker has not acknowledged yet. Inspect teler sync status.'
        )
      output.write(
        output.json
          ? `${JSON.stringify({ stopped: true })}\n`
          : 'Sync daemon stopped; registrations retained.\n'
      )
    } finally {
      store.close()
    }
    return
  }
  if (action === 'daemon') {
    assertNoFlags(args)
    if (args.length) throw new UsageError('Usage: teler sync daemon')
    if (!(await runSyncWorker(deps))) output.write('Sync daemon is already running.\n')
    return
  }
  if (['list', 'status', 'pause', 'resume', 'remove', 'retry'].includes(action ?? '')) {
    assertNoFlags(args)
    const management = action !== 'list' && action !== 'status'
    if (args.length !== (management ? 1 : 0))
      throw new UsageError(`Usage: teler sync ${action}${management ? ' <id>' : ''}`)
    const store = new SyncStore(join(directory, 'sync.db'))
    try {
      if (management) {
        const id = args[0] ?? ''
        if (!store.get(id)) throw new UsageError('Sync registration not found')
        if (action === 'retry') store.retryNow(id)
        else if (action === 'remove') {
          const files = store.files(id)
          store.remove(id)
          for (const file of files)
            if (file.snapshotPath) await unlink(file.snapshotPath).catch(() => undefined)
        } else
          store.update(id, {
            paused: action === 'pause',
            status: action === 'pause' ? 'paused' : 'pending',
          })
        if (action === 'resume') startSyncDaemon(deps.env)
      }
      const registrations = store.list().map((registration) => ({
        ...registration,
        ...(action === 'status' ? { files: store.files(registration.id) } : {}),
      }))
      if (output.json)
        output.write(
          `${JSON.stringify({
            daemonRunning: store.running(),
            throttledUntil: store.throttledUntil() || null,
            registrations,
          })}\n`
        )
      else if (!registrations.length) output.write('No folders tracked.\n')
      else
        for (const registration of registrations) {
          output.write(
            `${registration.id}\t${registration.paused ? 'paused' : registration.status}\t${registration.localPath} → ${registration.origin}${registration.destination}\n`
          )
          if (action === 'status')
            for (const file of store.files(registration.id))
              output.write(`  ${file.status}\t${file.relativePath}\n`)
        }
    } finally {
      store.close()
    }
    return
  }
  const destinationRaw = takeOption(args, '--to')
  const organizationOption = takeOption(args, '--org')
  const projectId = takeOption(args, '--project')
  const timeoutRaw = takeOption(args, '--timeout')
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) * 1_000 : 120_000
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 3_600_000)
    throw new UsageError('--timeout must be between 1 and 3600 seconds')
  const once = takeFlag(args, '--once')
  const dryRun = takeFlag(args, '--dry-run')
  assertNoFlags(args)
  if (!action || args.length || !destinationRaw)
    throw new UsageError(
      'Usage: teler sync <folder> --to </personal/path|/organization/path> [--org <id>] [--project <id>] [--once] [--dry-run]'
    )
  if (projectId !== undefined && !PROJECT_ID.test(projectId))
    throw new UsageError('--project must be a Teler project id (prj_…)')
  const destination = posix.normalize(destinationRaw).replace(/\/$/, '')
  if (
    !/^\/(personal|organization)(\/|$)/.test(destination) ||
    destinationRaw.split('/').includes('..')
  )
    throw new UsageError('Sync destination must be inside /personal or /organization')
  const rootInfo = await lstat(action)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new UsageError('Sync folder must be a local directory, not a symlink')
  const localPath = await realpath(action)
  if (dryRun) {
    const scan = await scanFolder(localPath, 0, protectedSyncPaths(deps.env))
    const preview = {
      localPath,
      destination,
      files: scan.files.map((file) => ({
        relativePath: file.relativePath,
        hash: file.hash,
        bytes: file.size,
      })),
      skipped: scan.skipped,
    }
    output.write(
      output.json
        ? `${JSON.stringify(preview)}\n`
        : `${preview.files
            .map((file) => `upload\t${posix.join(destination, file.relativePath)}`)
            .concat(preview.skipped.map((file) => `${file.reason}\t${file.relativePath}`))
            .join('\n')}\n`
    )
    return
  }
  const deadline = Date.now() + timeoutMs
  const requestSignal = AbortSignal.timeout(once ? timeoutMs : 60_000)
  const baseUrl = resolveTelerUrl(deps.env)
  let credentialStore = deps.store
  const credential = await resolveCredential(
    () => (credentialStore ??= createConfiguredCredentialStore(deps.env)),
    baseUrl.origin,
    deps.env
  )
  if (!credential) throw new UsageError('Not authenticated. Run `teler auth login`.')
  const identity = await authStatus(baseUrl, credential.token, (input, init) =>
    (deps.fetch ?? fetch)(input, {
      ...init,
      signal: AbortSignal.any([requestSignal, ...(init?.signal ? [init.signal] : [])]),
    })
  )
  const organizationId = organizationOption ?? identity.activeOrganizationId
  if (!organizationId) throw new UsageError('No active organization; pass --org <id>')
  const store = new SyncStore(join(directory, 'sync.db'))
  const registration = store.register({
    localPath,
    origin: baseUrl.origin,
    accountId: identity.user.id,
    organizationId,
    destination,
    ...(projectId ? { projectId } : {}),
  })
  store.close()
  if (once) {
    // --once shares the daemon lease: two processes must never promote the same source concurrently.
    if (
      !(await runSyncWorker(
        { ...deps, store: credentialStore },
        registration.id,
        Math.max(1, deadline - Date.now())
      ))
    )
      throw new UsageError(
        'Sync daemon is running; it will reconcile this registration. Stop it before using --once.'
      )
  } else startSyncDaemon(deps.env)
  const latestStore = new SyncStore(join(directory, 'sync.db'))
  const latest = latestStore.get(registration.id) ?? registration
  latestStore.close()
  output.write(
    output.json
      ? `${JSON.stringify(latest)}\n`
      : `Tracking ${localPath} (${registration.id}). Use teler sync status to inspect processing.\n`
  )
}
