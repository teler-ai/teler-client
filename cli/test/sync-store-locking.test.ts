import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SyncStore } from '../src/sync-store'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

// Status commands open the store while the daemon writes to it. Opening must
// wait for a briefly held lock instead of failing with "database is locked".
test('opening the store waits for another process that holds the database lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'teler-sync-lock-'))
  directories.push(directory)
  const path = join(directory, 'sync.db')
  const holder = Bun.spawn(
    [
      process.execPath,
      '-e',
      `const { Database } = require('bun:sqlite')
       const db = new Database(${JSON.stringify(path)}, { create: true })
       db.exec('BEGIN EXCLUSIVE; CREATE TABLE held (value TEXT)')
       console.log('locked')
       setTimeout(() => { db.exec('COMMIT'); db.close() }, 700)`,
    ],
    { stdout: 'pipe', stderr: 'inherit' }
  )
  const reader = holder.stdout.getReader()
  const { value } = await reader.read()
  expect(new TextDecoder().decode(value)).toContain('locked')

  const store = new SyncStore(path)
  try {
    expect(store.list()).toEqual([])
  } finally {
    store.close()
    await holder.exited
  }
}, 20_000)
