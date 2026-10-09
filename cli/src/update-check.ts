import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { version } from '../package.json'
import { isNewer, latestRelease, type ReleaseFetch } from './releases'
import { isCompiledModule } from './runtime'
import { removeUpdateLeftovers } from './update'

const CHECK_INTERVAL_MS = 24 * 60 * 60_000
/** After a failed check (offline, rate-limited), wait this long before trying again. */
const RETRY_INTERVAL_MS = 60 * 60_000
const CHECK_TIMEOUT_MS = 3_000
const cacheSchema = z.object({
  checkedAt: z.number(),
  latest: z.string().nullable(),
  failed: z.boolean().optional(),
})

export interface UpdateNoticeDeps {
  env: NodeJS.ProcessEnv
  fetch?: ReleaseFetch
  moduleUrl?: string
  /** stderr is a terminal: the notice is for a person. */
  interactive?: boolean
  execPath?: string
  now?: () => number
  home?: string
  currentVersion?: string
}

export function updateCheckPath(env: NodeJS.ProcessEnv, home = homedir()): string {
  const state = env.XDG_STATE_HOME?.trim() || join(home, '.local', 'state')
  return join(state, 'teler', 'update-check.json')
}

/**
 * Release builds check for updates when a person runs them: never for `--json`
 * output, the sync daemon, CI, Teler Desktop's sidecar or TELER_NO_UPDATE_CHECK.
 */
export function shouldCheckForUpdates(argv: readonly string[], deps: UpdateNoticeDeps): boolean {
  const { env } = deps
  if (!isCompiledModule(deps.moduleUrl ?? import.meta.url)) return false
  if (env.TELER_NO_UPDATE_CHECK?.trim() || env.CI?.trim()) return false
  if (env.TELER_SYNC_DAEMON?.trim() === 'managed') return false
  if (!(deps.interactive ?? process.stderr.isTTY === true) || argv.includes('--json')) return false
  const [group, action] = argv
  return group !== 'update' && !(group === 'sync' && action === 'daemon')
}

async function checkedRecently(path: string, now: number): Promise<boolean> {
  try {
    const cached = cacheSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    const interval = cached.failed ? RETRY_INTERVAL_MS : CHECK_INTERVAL_MS
    return cached.checkedAt <= now && now - cached.checkedAt < interval
  } catch {
    return false
  }
}

/**
 * Starts a daily update check alongside a command. `finish` prints a notice
 * when that check found a newer release; it waits at most a few seconds.
 */
export function startUpdateNotice(
  argv: readonly string[],
  deps: UpdateNoticeDeps
): { finish(write: (text: string) => void): Promise<void> } {
  if (isCompiledModule(deps.moduleUrl ?? import.meta.url))
    void removeUpdateLeftovers(deps.execPath ?? process.execPath)
  if (!shouldCheckForUpdates(argv, deps)) return { finish: async () => undefined }
  const now = (deps.now ?? Date.now)()
  const path = updateCheckPath(deps.env, deps.home)
  const remember = (entry: z.infer<typeof cacheSchema>) =>
    mkdir(dirname(path), { recursive: true, mode: 0o700 })
      .then(() => writeFile(path, JSON.stringify(entry), { mode: 0o600 }))
      .catch(() => undefined)
  const latest = (async () => {
    if (await checkedRecently(path, now)) return null
    try {
      const release = await latestRelease('cli', {
        fetch: deps.fetch,
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      })
      const value = release?.version ?? null
      await remember({ checkedAt: now, latest: value })
      return value
    } catch {
      await remember({ checkedAt: now, latest: null, failed: true })
      return null
    }
  })().catch(() => null)
  return {
    async finish(write) {
      const value = await latest
      const current = deps.currentVersion ?? version
      if (value && isNewer(value, current))
        write(`\nteler ${value} is available (you have ${current}). Run \`teler update\`.\n`)
    },
  }
}
