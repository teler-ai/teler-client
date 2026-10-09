import { execFile, spawn } from 'node:child_process'
import type { DaemonHandle } from './daemon-supervisor'
import type { SidecarCommand } from './sidecar'
import type { CliRunner } from './sync-cli'

// `sync status` lists every tracked file; leave generous room for large folders.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** Runs one CLI command to completion. Output is parsed, never logged. */
export function createCliRunner(
  sidecar: SidecarCommand,
  environment: () => NodeJS.ProcessEnv
): CliRunner {
  return {
    run(args, options = {}) {
      return new Promise((resolve) => {
        execFile(
          sidecar.command,
          [...sidecar.args, ...args],
          {
            env: environment(),
            encoding: 'utf8',
            maxBuffer: MAX_OUTPUT_BYTES,
            timeout: options.timeoutMs ?? 60_000,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
            // Killed without an error code: the time limit, not maxBuffer, stopped it.
            const timedOut = error?.killed === true && typeof error.code !== 'string'
            resolve({ exitCode, stdout, stderr, timedOut })
          }
        )
      })
    },
  }
}

/** Starts the long-running `teler sync daemon` owned by the supervisor. */
export function spawnSyncDaemon(sidecar: SidecarCommand, env: NodeJS.ProcessEnv): DaemonHandle {
  const child = spawn(sidecar.command, [...sidecar.args, 'sync', 'daemon'], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  })
  const exited = new Promise<{ code: number | null }>((resolve) => {
    child.once('exit', (code) => resolve({ code }))
    // A missing or unlaunchable sidecar counts as a crash and is retried with backoff.
    child.once('error', () => resolve({ code: -1 }))
  })
  return { exited, kill: () => void child.kill() }
}
