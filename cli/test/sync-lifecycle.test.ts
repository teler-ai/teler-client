import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/index'
import { runSyncWorker } from '../src/sync-daemon'
import { syncDirectory } from '../src/sync-paths'
import { SyncStore } from '../src/sync-store'

test('offline stop command acknowledges worker shutdown without deleting registrations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-stop-'))
  const env = { XDG_STATE_HOME: root }
  try {
    const store = new SyncStore(join(syncDirectory(env), 'sync.db'))
    const registration = store.register({
      localPath: '/missing-root',
      origin: 'https://app.teler.ai',
      accountId: 'user',
      organizationId: 'org',
      destination: '/personal/reports',
    })
    store.update(registration.id, { paused: true })
    const worker = runSyncWorker({ env })
    expect(store.running()).toBe(true)
    let output = ''
    expect(
      await main(['sync', 'stop', '--json'], {
        env,
        writeOut: (text) => {
          output += text
        },
        writeErr: () => undefined,
      })
    ).toBe(0)
    expect(JSON.parse(output)).toEqual({ stopped: true })
    expect(await worker).toBe(true)
    expect(store.running()).toBe(false)
    expect(store.list()).toHaveLength(1)
    store.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('once enforces its overall deadline on an in-flight authentication request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-timeout-'))
  const env = { XDG_STATE_HOME: root, TELER_TOKEN: 'test-token' }
  try {
    const source = join(root, 'source')
    await mkdir(source)
    await writeFile(join(source, 'data.csv'), 'a\n1\n')
    const store = new SyncStore(join(syncDirectory(env), 'sync.db'))
    const registration = store.register({
      localPath: source,
      origin: 'https://app.teler.ai',
      accountId: 'user',
      organizationId: 'org',
      destination: '/personal/reports',
    })
    let aborted = false
    const started = Date.now()
    await expect(
      runSyncWorker(
        {
          env,
          fetch: async (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                'abort',
                () => {
                  aborted = true
                  reject(new Error('Aborted'))
                },
                { once: true }
              )
            }),
        },
        registration.id,
        30
      )
    ).rejects.toThrow('timed out')
    expect(aborted).toBe(true)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(store.running()).toBe(false)
    expect(store.list()).toHaveLength(1)
    store.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
