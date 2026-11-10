import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'

/** The CLI entry of the app's `@teler-ai/cli` dependency, resolved from the app directory. */
export function developmentCliEntry(appPath: string): string {
  return createRequire(join(appPath, 'package.json')).resolve('@teler-ai/cli/cli')
}

/** How to run the bundled `teler` CLI. */
export interface SidecarCommand {
  command: string
  args: string[]
}

export interface SidecarLocation {
  isPackaged: boolean
  resourcesPath: string
  /** `app.getAppPath()`: `desktop/` in development. */
  appPath: string
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}

export function resolveSidecar(location: SidecarLocation): SidecarCommand {
  const override = location.env.TELER_DESKTOP_SIDECAR?.trim()
  if (override) return { command: override, args: [] }
  if (location.isPackaged) {
    const binary = location.platform === 'win32' ? 'teler.exe' : 'teler'
    return { command: join(location.resourcesPath, 'sidecar', binary), args: [] }
  }
  // Development runs the `@teler-ai/cli` package's `teler` entry with Bun.
  return {
    command: location.env.BUN_EXECUTABLE?.trim() || 'bun',
    args: [developmentCliEntry(location.appPath)],
  }
}

export interface SidecarEnvironmentInput {
  base: NodeJS.ProcessEnv
  origin: string
  /** The app's private data directory; sync state never mixes with a CLI install. */
  dataDir: string
  token: string | null
}

/**
 * The CLI's environment. Inherited `TELER_*` values are dropped so a developer
 * shell cannot redirect the app's sync, and the OS credential store is never
 * consulted: the app supplies its own token or none.
 */
export function sidecarEnvironment(input: SidecarEnvironmentInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(input.base)) {
    if (key.startsWith('TELER_') || key.startsWith('ELECTRON_') || key === 'NODE_OPTIONS') continue
    env[key] = value
  }
  env.TELER_URL = input.origin
  env.TELER_SYNC_DAEMON = 'managed'
  // The app's own updates replace the sidecar; it never checks for CLI releases.
  env.TELER_NO_UPDATE_CHECK = '1'
  env.TELER_CREDENTIAL_STORE = 'file'
  env.XDG_STATE_HOME = join(input.dataDir, 'state')
  env.XDG_CONFIG_HOME = join(input.dataDir, 'config')
  if (input.token) env.TELER_TOKEN = input.token
  return env
}

export interface LinkSidecarEnvironmentInput {
  base: NodeJS.ProcessEnv
  origin: string
  /** The app's private Link directory, apart from sync's. */
  dataDir: string
  home: string
  platform: NodeJS.Platform
  /** Pairing only: the helper's own secret, or null while pairing. */
  pairing: { deviceId: string; organizationId: string; secret: string } | null
}

/** Where Claude Code and Codex are usually installed, for an app launched without a shell's PATH. */
function engineSearchPath(home: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return []
  return [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
}

/**
 * The environment of `teler link` in managed mode. The app owns the pairing: the secret reaches
 * the helper only as `TELER_LINK_PAIRING`, and the CLI's own credential store is never used.
 * Unlike sync, the helper keeps the person's own configuration directory, where the engines and
 * `teler link account add` keep their accounts, and finds engines installed outside the
 * minimal PATH an app launched from the Dock or a launcher gets.
 */
export function linkSidecarEnvironment(input: LinkSidecarEnvironmentInput): NodeJS.ProcessEnv {
  const env = sidecarEnvironment({ ...input, token: null })
  delete env.TELER_SYNC_DAEMON
  const configHome = input.base.XDG_CONFIG_HOME
  if (configHome) env.XDG_CONFIG_HOME = configHome
  else delete env.XDG_CONFIG_HOME
  const path = input.base.PATH ?? ''
  const entries = path.split(delimiter).filter(Boolean)
  const extra = engineSearchPath(input.home, input.platform).filter((dir) => !entries.includes(dir))
  if (extra.length > 0) env.PATH = [...entries, ...extra].join(delimiter)
  env.TELER_LINK_MANAGED = '1'
  if (input.pairing) {
    const { deviceId, organizationId, secret } = input.pairing
    env.TELER_LINK_PAIRING = JSON.stringify({ deviceId, secret, organizationId })
  }
  return env
}

/**
 * The environment for one CLI launch, with the current Cloudflare Access token
 * (see access-token.ts): a renewal reaches the next launch, never a stale copy.
 */
export function withSidecarAccess(
  env: NodeJS.ProcessEnv,
  accessToken: string | null
): NodeJS.ProcessEnv {
  const next = { ...env }
  if (accessToken) next.TELER_ACCESS_TOKEN = accessToken
  else delete next.TELER_ACCESS_TOKEN
  return next
}
