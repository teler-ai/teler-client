import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcile } from './sync-engine'
import { protectedSyncPaths, syncDirectory } from './sync-paths'
export { syncDirectory } from './sync-paths'
import { createSyncRemote, type SyncRemoteDeps } from './sync-remote'
import { UsageError } from './errors'
import { isCompiledModule } from './runtime'
import { SyncStore } from './sync-store'

export function syncDaemonCommand(execPath = process.execPath, moduleUrl = import.meta.url) {
  if (isCompiledModule(moduleUrl)) return [execPath, 'sync', 'daemon']
  return [execPath, fileURLToPath(new URL('./index.ts', moduleUrl)), 'sync', 'daemon']
}
export function startSyncDaemon(env: NodeJS.ProcessEnv) {
  // A supervising application (Teler Desktop) runs `teler sync daemon` itself.
  if (env.TELER_SYNC_DAEMON?.trim() === 'managed') return
  const [command = process.execPath, ...args] = syncDaemonCommand()
  const child = spawn(command, args, { detached: true, stdio: 'ignore', env, windowsHide: true })
  child.unref()
}
export async function runSyncWorker(deps: SyncRemoteDeps, onceId?: string, timeoutMs = 120_000) {
  const directory = syncDirectory(deps.env)
  const store = new SyncStore(join(directory, 'sync.db'))
  const deadline = Date.now() + timeoutMs
  const controller = new AbortController()
  const signal = onceId
    ? AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])
    : controller.signal
  const owner = `${process.pid}:${randomUUID()}`
  if (!store.acquire(owner)) {
    store.close()
    return false
  }
  const renew = setInterval(() => store.renew(owner), 10_000)
  const watchers = new Map<string, FSWatcher>()
  let stopped = false
  let wake: (() => void) | undefined
  const stop = () => {
    stopped = true
    controller.abort()
    wake?.()
  }
  const control = setInterval(() => {
    if (store.stopRequested(owner) || !store.owns(owner)) stop()
    if (signal.aborted) wake?.()
  }, 250)
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  try {
    store.clearAuthenticationBackoff()
    do {
      signal.throwIfAborted()
      const registrations = store
        .list()
        .filter((registration) => !registration.paused && (!onceId || registration.id === onceId))
      const active = new Set(registrations.map((registration) => registration.id))
      for (const [id, watcher] of watchers)
        if (!active.has(id)) {
          watcher.close()
          watchers.delete(id)
        }
      for (const registration of registrations) {
        if (stopped || !store.owns(owner)) break
        if (!onceId && !watchers.has(registration.id)) {
          try {
            const watcher = watch(registration.localPath, { recursive: true }, () => wake?.())
            watcher.on('error', () => {
              watcher.close()
              watchers.delete(registration.id)
            })
            watchers.set(registration.id, watcher)
          } catch {
            /* Periodic scans recover unavailable roots and unsupported watchers. */
          }
        }
        await reconcile(
          store,
          registration.id,
          createSyncRemote(registration.origin, {
            ...deps,
            signal,
            fetch: async (input, init) => {
              if (
                !store.owns(owner) ||
                store.get(registration.id)?.paused ||
                !store.get(registration.id)
              )
                throw new Error('Sync ownership changed')
              return (deps.fetch ?? fetch)(input, init)
            },
          }),
          join(directory, 'snapshots'),
          1_000,
          protectedSyncPaths(deps.env),
          signal
        )
      }
      if (stopped || !store.owns(owner)) break
      signal.throwIfAborted()
      if (onceId) {
        const status = store.get(onceId)?.status
        if (status === 'ready') break
        if (status !== 'pending' || Date.now() >= deadline)
          throw new UsageError(`Sync ${status ?? 'removed'}; inspect teler sync status`)
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, onceId ? 1_000 : 5_000)
        function done() {
          clearTimeout(timer)
          wake = undefined
          resolve()
        }
        wake = done
      })
    } while (!stopped)
    return true
  } catch (error) {
    if (stopped) return true
    if (signal.aborted)
      throw new UsageError('Sync timed out; pending work is retained. Inspect teler sync status.')
    throw error
  } finally {
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
    for (const watcher of watchers.values()) watcher.close()
    clearInterval(control)
    clearInterval(renew)
    store.release(owner)
    store.close()
  }
}
