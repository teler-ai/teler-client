import { createHash, randomUUID } from 'node:crypto'
import { chmod, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { version } from '../package.json'
import { assertNoFlags, takeFlag } from './command-args'
import { CommandError, UsageError } from './errors'
import {
  DOWNLOAD_PREFIX,
  isNewer,
  latestRelease,
  ReleaseCheckError,
  type Release,
  type ReleaseAsset,
  type ReleaseFetch,
} from './releases'
import { isCompiledModule, releaseBinaryName, releaseTarget } from './runtime'

const CHECKSUMS = 'SHA256SUMS.txt'
const MAX_BINARY_BYTES = 512 * 1024 * 1024
const MAX_CHECKSUM_BYTES = 64 * 1024
const CHECK_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000

export interface UpdateDeps {
  fetch?: ReleaseFetch
  /** The running executable, which an update replaces. */
  execPath?: string
  moduleUrl?: string
  platform?: NodeJS.Platform
  arch?: string
  currentVersion?: string
}

interface Output {
  json: boolean
  write(text: string): void
}

interface UpdateResult {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
}

function describe(result: UpdateResult, checkOnly: boolean): string {
  if (!result.latestVersion) return 'No teler CLI release is available yet.\n'
  if (!result.updateAvailable) return `teler ${result.currentVersion} is up to date.\n`
  const install = checkOnly ? ' Run `teler update` to install it.' : ''
  return `teler ${result.latestVersion} is available (you have ${result.currentVersion}).${install}\n`
}

/** `teler update [--check]`: report or install the newest release build. */
export async function runUpdateCommand(
  action: string | undefined,
  args: string[],
  output: Output,
  deps: UpdateDeps = {}
): Promise<number> {
  if (action !== undefined) args.unshift(action)
  const checkOnly = takeFlag(args, '--check')
  assertNoFlags(args)
  if (args.length > 0) throw new UsageError('Usage: teler update [--check] [--json]')
  const current = deps.currentVersion ?? version
  let release: Release | null
  try {
    release = await latestRelease('cli', {
      fetch: deps.fetch,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
  } catch (error) {
    const status = error instanceof ReleaseCheckError ? ` (HTTP ${error.status})` : ''
    throw new CommandError(
      'UPDATE_CHECK_FAILED',
      `Could not check for teler updates${status}. Try again later.`
    )
  }
  const result: UpdateResult = {
    currentVersion: current,
    latestVersion: release?.version ?? null,
    updateAvailable: release !== null && isNewer(release.version, current),
    releaseUrl: release?.pageUrl ?? null,
  }
  if (checkOnly || !release || !result.updateAvailable) {
    output.write(output.json ? `${JSON.stringify(result)}\n` : describe(result, checkOnly))
    return 0
  }
  // A symlinked executable is updated where it lives.
  const executable = await realpath(deps.execPath ?? process.execPath)
  const binary = installableBinary(release, deps)
  await install(release, binary, executable, deps)
  output.write(
    output.json
      ? `${JSON.stringify({ ...result, updated: true })}\n`
      : `Updated teler ${current} → ${release.version}.\n` +
          'A running sync daemon keeps the previous version until it restarts: run ' +
          '`teler sync stop`, then any `teler sync` command.\n'
  )
  return 0
}

function installableBinary(release: Release, deps: UpdateDeps): ReleaseAsset {
  if (!isCompiledModule(deps.moduleUrl ?? import.meta.url))
    throw new CommandError(
      'UPDATE_UNSUPPORTED',
      `teler ${release.version} is available, but this teler runs from source or a package: ` +
        `update it there, or install a release build from ${release.pageUrl}`
    )
  const target = releaseTarget(deps.platform ?? process.platform, deps.arch ?? process.arch)
  const asset = target && release.assets.find((item) => item.name === releaseBinaryName(target))
  if (!asset)
    throw new CommandError(
      'UPDATE_UNAVAILABLE',
      `teler ${release.version} has no build for this platform; see ${release.pageUrl}`
    )
  return asset
}

async function download(asset: ReleaseAsset, limit: number, fetchImpl: ReleaseFetch) {
  if (!asset.url.startsWith(DOWNLOAD_PREFIX) || asset.size > limit)
    throw new CommandError('UPDATE_UNAVAILABLE', `The ${asset.name} download is not available.`)
  const response = await fetchImpl(asset.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok)
    throw new CommandError('UPDATE_DOWNLOAD_FAILED', `Could not download ${asset.name}.`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > limit)
    throw new CommandError('UPDATE_DOWNLOAD_FAILED', `${asset.name} is larger than expected.`)
  return bytes
}

/** The SHA-256 that `sha256sum` published for a file name. */
export function publishedChecksum(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim())
    if (match?.[2] === name) return match[1] ?? null
  }
  return null
}

async function install(
  release: Release,
  binary: ReleaseAsset,
  executable: string,
  deps: UpdateDeps
): Promise<void> {
  const fetchImpl = deps.fetch ?? fetch
  const sums = release.assets.find((item) => item.name === CHECKSUMS)
  if (!sums) throw new CommandError('UPDATE_UNAVAILABLE', 'The release has no checksums.')
  const expected = publishedChecksum(
    new TextDecoder().decode(await download(sums, MAX_CHECKSUM_BYTES, fetchImpl)),
    binary.name
  )
  const bytes = await download(binary, MAX_BINARY_BYTES, fetchImpl)
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new CommandError(
      'UPDATE_VERIFICATION_FAILED',
      'The download does not match its published checksum; nothing was changed.'
    )
  await replaceExecutable(executable, bytes, (deps.platform ?? process.platform) === 'win32')
}

/**
 * Swaps the executable in one rename. Windows cannot overwrite a running
 * executable, so it moves the old one aside first; the next run removes it.
 */
export async function replaceExecutable(path: string, bytes: Uint8Array, windows: boolean) {
  const temporary = join(dirname(path), `.teler-update-${randomUUID()}`)
  const aside = `${path}.${randomUUID()}.old`
  let movedAside = false
  try {
    await writeFile(temporary, bytes, { mode: 0o755 })
    await chmod(temporary, 0o755)
    if (windows) {
      await rename(path, aside)
      movedAside = true
    }
    await rename(temporary, path)
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined)
    if (movedAside) await rename(aside, path).catch(() => undefined)
    throw new CommandError(
      'UPDATE_NOT_WRITABLE',
      `Could not replace ${path}. Check that you can write to it, or reinstall teler.`
    )
  }
}

const LEFTOVER_AGE_MS = 60 * 60_000

/**
 * Removes what an update left next to the executable: the previous Windows
 * executable, and a download an interrupted update never finished (once it is
 * old enough not to belong to a running update).
 */
export async function removeUpdateLeftovers(path: string, now = Date.now()): Promise<void> {
  const directory = dirname(path)
  const name = basename(path)
  const entries = await readdir(directory).catch(() => [])
  await Promise.all(
    entries.map(async (entry) => {
      const file = join(directory, entry)
      const aside = entry.startsWith(`${name}.`) && entry.endsWith('.old')
      const download =
        entry.startsWith('.teler-update-') &&
        now - (await stat(file).catch(() => ({ mtimeMs: now }))).mtimeMs > LEFTOVER_AGE_MS
      if (aside || download) await rm(file, { force: true }).catch(() => undefined)
    })
  )
}
