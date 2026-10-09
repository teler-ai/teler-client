import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createCliRunner, spawnSyncDaemon } from '../../src/main/cli-process'
import { resolveSidecar, sidecarEnvironment } from '../../src/main/sidecar'
import { SyncCli } from '../../src/main/sync-cli'
import { toFolderPreview } from '../../src/main/sync-state'

// Runs this checkout's real CLI so the desktop parser is pinned to its JSON.
const appPath = fileURLToPath(new URL('../..', import.meta.url))
const sidecar = resolveSidecar({
  isPackaged: false,
  resourcesPath: '',
  appPath,
  platform: process.platform,
  env: { BUN_EXECUTABLE: process.env.BUN_EXECUTABLE ?? 'bun' },
})
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function setup(options: { origin?: string; token?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'teler-desktop-cli-'))
  directories.push(root)
  const env = sidecarEnvironment({
    base: process.env,
    origin: options.origin ?? 'http://127.0.0.1:9',
    dataDir: join(root, 'data'),
    token: options.token ?? null,
  })
  return { root, env, cli: new SyncCli(createCliRunner(sidecar, () => env)) }
}

/** Answers only the account lookup that registration performs. */
async function accountServer() {
  const server = createServer((request, response) => {
    const authorized = request.headers.authorization === 'Bearer contract-token'
    response.writeHead(authorized && request.url === '/api/teler-cli/me' ? 200 : 401, {
      'Content-Type': 'application/json',
    })
    response.end(
      JSON.stringify(
        authorized
          ? { user: { id: 'user_contract', name: 'Ana' }, activeOrganizationId: 'org_contract' }
          : { error: 'Unauthorized' }
      )
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('bundled CLI contract', () => {
  it('lists an empty, isolated sync state', async () => {
    const { cli } = await setup()
    const empty = { daemonRunning: false, throttledUntil: null, registrations: [] }
    await expect(cli.list()).resolves.toEqual(empty)
    await expect(cli.status()).resolves.toEqual(empty)
  })

  it('previews a folder without credentials', async () => {
    const { root, cli } = await setup()
    const folder = join(root, 'Reports')
    await mkdir(folder)
    for (const [name, text] of [
      ['sales.csv', 'a\n1\n'],
      ['.env', 'SECRET=1'],
      ['archive.zip', 'zip'],
    ] as const) {
      await writeFile(join(folder, name), text)
      await utimes(join(folder, name), new Date(0), new Date(0))
    }
    const preview = toFolderPreview(
      await cli.preview({ localPath: folder, destination: '/personal/R' })
    )
    expect(preview).toMatchObject({
      fileCount: 1,
      totalBytes: 4,
      sampleFiles: ['sales.csv'],
      skipped: { excluded: 1, unsupported: 1, other: 0 },
    })
  })

  it('registers, lists, pauses, resumes and removes a folder', async () => {
    const server = await accountServer()
    try {
      const { root, cli } = await setup({ origin: server.origin, token: 'contract-token' })
      const folder = join(root, 'Exports')
      await mkdir(folder)
      const registration = await cli.register({ localPath: folder, destination: '/personal/X' })
      expect(registration).toMatchObject({
        localPath: folder,
        origin: server.origin,
        accountId: 'user_contract',
        organizationId: 'org_contract',
        destination: '/personal/X',
        paused: false,
      })
      const status = await cli.status()
      expect(status.daemonRunning).toBe(false)
      expect(status.registrations).toEqual([expect.objectContaining({ id: registration.id })])
      expect(status.registrations[0]?.files).toEqual([])

      await cli.pause(registration.id)
      expect((await cli.list()).registrations[0]).toMatchObject({ paused: true, status: 'paused' })
      await cli.resume(registration.id)
      expect((await cli.list()).registrations[0]).toMatchObject({ paused: false })
      await cli.remove(registration.id)
      expect((await cli.list()).registrations).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('registers a folder into the organization and project the web app asked for', async () => {
    const server = await accountServer()
    try {
      const { root, cli } = await setup({ origin: server.origin, token: 'contract-token' })
      const registration = await cli.register({
        localPath: root,
        destination: '/organization/Q3',
        organizationId: 'org_other',
        projectId: 'prj_01h455vb4pex5vsknk084sn02q',
      })
      expect(registration).toMatchObject({
        organizationId: 'org_other',
        projectId: 'prj_01h455vb4pex5vsknk084sn02q',
      })
    } finally {
      await server.close()
    }
  })

  it('reports registration without a token as not connected', async () => {
    const { root, cli } = await setup()
    await expect(
      cli.register({ localPath: root, destination: '/personal/x' })
    ).rejects.toMatchObject({ code: 'not-connected' })
  })

  it('acknowledges a stop request when no daemon runs', async () => {
    const { cli } = await setup()
    await expect(cli.stop()).resolves.toBeUndefined()
  })

  it('runs a managed daemon that stops on request', async () => {
    const { env, cli } = await setup()
    const daemon = spawnSyncDaemon(sidecar, env)
    let running = false
    for (let attempt = 0; attempt < 100 && !running; attempt++) {
      running = (await cli.list()).daemonRunning
      if (!running) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(running).toBe(true)
    await cli.stop()
    await expect(daemon.exited).resolves.toEqual({ code: 0 })
  })
}, 60_000)
