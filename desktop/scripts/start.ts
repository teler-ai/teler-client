#!/usr/bin/env bun
/**
 * Development launcher: builds, then runs Electron against `TELER_URL`
 * (default production), an origin that serves the whole app (plus
 * `TELER_AUTH_URL` when sign-in is on a separate origin). The sync helper
 * runs the CLI package with Bun. On macOS it runs a Teler-named copy of
 * Electron (see dev-mac-app.ts).
 *
 *   TELER_URL=https://app.teler.example bun run start
 */
import { join } from 'node:path'
import { prepareDevMacApp } from './dev-mac-app'

const appDir = join(import.meta.dir, '..')
const built = Bun.spawnSync([process.execPath, join(appDir, 'scripts', 'build.ts')], {
  stdout: 'inherit',
  stderr: 'inherit',
})
if (built.exitCode !== 0) process.exit(built.exitCode ?? 1)

const executable = (process.platform === 'darwin' && (await prepareDevMacApp(appDir))) || 'electron'
const electron = Bun.spawn([executable, appDir, ...process.argv.slice(2)], {
  cwd: appDir,
  env: { ...process.env, BUN_EXECUTABLE: process.execPath },
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(await electron.exited)
