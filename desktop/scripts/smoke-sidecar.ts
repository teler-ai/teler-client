#!/usr/bin/env bun
/**
 * Runs the sidecar compiled for this machine the way the app does, with a
 * throwaway data directory and no server. It lists sync state, previews a
 * folder (which opens and hashes files like a sync) and runs the managed
 * daemon until a stop request. Release builds run it on each OS.
 *
 *   bun scripts/smoke-sidecar.ts
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCliRunner, spawnSyncDaemon } from '../src/main/cli-process'
import type { DaemonHandle } from '../src/main/daemon-supervisor'
import { sidecarEnvironment } from '../src/main/sidecar'
import { SyncCli } from '../src/main/sync-cli'
import { toFolderPreview } from '../src/main/sync-state'
import { hostSidecarTarget, sidecarBinary } from './sidecar-targets'

function check(condition: boolean, failure: string): void {
  if (!condition) throw new Error(`Sidecar smoke test failed: ${failure}`)
}

const sidecar = { command: sidecarBinary(hostSidecarTarget()), args: [] }
const root = await mkdtemp(join(tmpdir(), 'teler-sidecar-smoke-'))
let daemon: DaemonHandle | null = null
try {
  const env = sidecarEnvironment({
    base: process.env,
    // Nothing listens here; these commands need no server.
    origin: 'http://127.0.0.1:9',
    dataDir: join(root, 'data'),
    token: null,
  })
  const cli = new SyncCli(createCliRunner(sidecar, () => env))

  const initial = await cli.list()
  check(!initial.daemonRunning && initial.registrations.length === 0, 'sync state is not empty')

  const folder = join(root, 'Reports')
  await mkdir(folder)
  await writeFile(join(folder, 'sales.csv'), 'region,total\nnorth,1\n')
  await writeFile(join(folder, '.env'), 'SECRET=1')
  const preview = toFolderPreview(
    await cli.preview({ localPath: folder, destination: '/personal/Smoke' })
  )
  check(
    preview.fileCount === 1 && preview.skipped.excluded === 1,
    `unexpected preview ${JSON.stringify(preview)}`
  )

  daemon = spawnSyncDaemon(sidecar, env)
  let running = false
  for (let attempt = 0; attempt < 100 && !running; attempt++) {
    running = (await cli.list()).daemonRunning
    if (!running) await Bun.sleep(100)
  }
  check(running, 'the sync daemon did not start')
  await cli.stop()
  const exit = await Promise.race([daemon.exited, Bun.sleep(15_000).then(() => null)])
  check(exit?.code === 0, `the sync daemon did not stop cleanly: ${JSON.stringify(exit)}`)
  console.info(`✓ ${sidecar.command} lists, previews and runs the sync daemon`)
} finally {
  // Never leave a daemon behind, whichever step failed.
  if (daemon) {
    daemon.kill()
    await Promise.race([daemon.exited, Bun.sleep(5_000)])
  }
  // Best effort: Windows can hold a handle briefly, and a cleanup error must
  // not hide the real failure (or fail a passing run).
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
}
