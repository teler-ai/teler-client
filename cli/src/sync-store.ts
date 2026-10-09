import { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SyncFile, SyncIdentity, SyncRegistration } from './sync-types'

export class SyncStore {
  private readonly db: Database
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    chmodSync(dirname(path), 0o700)
    this.db = new Database(path, { create: true })
    chmodSync(path, 0o600)
    // Set the busy timeout first: switching to WAL takes a lock that the
    // daemon may briefly hold while status commands open the store.
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS registrations (id TEXT PRIMARY KEY, identity TEXT UNIQUE, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (registration TEXT, path TEXT, value TEXT NOT NULL, PRIMARY KEY(registration,path));
      CREATE TABLE IF NOT EXISTS stop_requests (owner TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS throttle (id INTEGER PRIMARY KEY CHECK(id=1), until INTEGER NOT NULL);`)
  }
  close() {
    this.db.close()
  }
  register(identity: SyncIdentity): SyncRegistration {
    const key = JSON.stringify([
      identity.localPath,
      identity.origin,
      identity.accountId,
      identity.organizationId,
      identity.destination,
      // Appended only when set, so registrations made before projects keep their key.
      ...(identity.projectId ? [identity.projectId] : []),
    ])
    const value: SyncRegistration = {
      ...identity,
      id: randomUUID(),
      paused: false,
      status: 'pending',
      checkedAt: null,
    }
    this.db
      .query('INSERT OR IGNORE INTO registrations VALUES (?,?,?)')
      .run(value.id, key, JSON.stringify(value))
    const row = this.db
      .query<{ value: string }, [string]>('SELECT value FROM registrations WHERE identity=?')
      .get(key)
    if (!row) throw new Error('Sync registration could not be saved')
    return JSON.parse(row.value) as SyncRegistration
  }
  list(): SyncRegistration[] {
    return this.db
      .query<{ value: string }, []>('SELECT value FROM registrations ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(row.value) as SyncRegistration)
  }
  get(id: string) {
    return this.list().find((value) => value.id === id)
  }
  update(id: string, patch: Partial<Pick<SyncRegistration, 'paused' | 'status' | 'checkedAt'>>) {
    this.db.transaction(() => {
      const current = this.get(id)
      if (current)
        this.db
          .query('UPDATE registrations SET value=? WHERE id=?')
          .run(JSON.stringify({ ...current, ...patch }), id)
    })()
  }
  remove(id: string) {
    this.db.transaction(() => {
      this.db.query('DELETE FROM files WHERE registration=?').run(id)
      this.db.query('DELETE FROM registrations WHERE id=?').run(id)
    })()
  }
  files(id: string): SyncFile[] {
    return this.db
      .query<{ value: string }, [string]>(
        'SELECT value FROM files WHERE registration=? ORDER BY path'
      )
      .all(id)
      .map((row) => JSON.parse(row.value) as SyncFile)
  }
  saveFile(file: SyncFile) {
    // A concurrent remove must not resurrect its local work.
    this.db.transaction(() => {
      if (!this.get(file.registrationId)) return
      this.db
        .query('INSERT OR REPLACE INTO files VALUES (?,?,?)')
        .run(file.registrationId, file.relativePath, JSON.stringify(file))
    })()
  }
  /** Teler limits upload starts per account: no file starts before this time. */
  throttle(until: number) {
    // Keep the later end: a shorter Retry-After must not shorten an existing limit.
    this.db
      .query(
        'INSERT INTO throttle VALUES (1,?) ON CONFLICT(id) DO UPDATE SET until=max(until, excluded.until)'
      )
      .run(until)
  }
  /** When uploads may start again; 0 when they are not limited. */
  throttledUntil(): number {
    const row = this.db.query<{ until: number }, []>('SELECT until FROM throttle WHERE id=1').get()
    return row && row.until > Date.now() ? row.until : 0
  }
  /** Retries the registration's waiting uploads on the worker's next pass. */
  retryNow(id: string) {
    for (const file of this.files(id))
      if (file.status === 'retrying' && file.retryAt !== 0) this.saveFile({ ...file, retryAt: 0 })
  }
  /** A newly started worker may hold a renewed credential: retry authentication failures now. */
  clearAuthenticationBackoff() {
    for (const registration of this.list())
      for (const file of this.files(registration.id))
        if (file.status === 'authentication-required' && file.retryAt !== 0)
          this.saveFile({ ...file, retryAt: 0 })
  }
  acquire(owner: string, now = Date.now()): boolean {
    return this.db.transaction(() => {
      this.db.query('DELETE FROM lease WHERE expires<?').run(now)
      this.db.query('INSERT OR IGNORE INTO lease VALUES (1,?,?)').run(owner, now + 30_000)
      return (
        this.db.query<{ owner: string }, []>('SELECT owner FROM lease WHERE id=1').get()?.owner ===
        owner
      )
    })()
  }
  running() {
    return Boolean(
      this.db
        .query<{ owner: string }, [number]>('SELECT owner FROM lease WHERE expires>=?')
        .get(Date.now())
    )
  }
  owns(owner: string) {
    return (
      this.db
        .query<{ owner: string }, [number]>('SELECT owner FROM lease WHERE expires>=?')
        .get(Date.now())?.owner === owner
    )
  }
  renew(owner: string) {
    this.db
      .query('UPDATE lease SET expires=? WHERE owner=? AND expires>=?')
      .run(Date.now() + 30_000, owner, Date.now())
  }
  requestStop(): string | null {
    return this.db.transaction(() => {
      const owner = this.db
        .query<{ owner: string }, [number]>('SELECT owner FROM lease WHERE expires>=?')
        .get(Date.now())?.owner
      if (!owner) return null
      this.db.query('INSERT OR IGNORE INTO stop_requests VALUES (?)').run(owner)
      return owner
    })()
  }
  stopRequested(owner: string) {
    return Boolean(
      this.db
        .query<{ owner: string }, [string]>('SELECT owner FROM stop_requests WHERE owner=?')
        .get(owner)
    )
  }
  release(owner: string) {
    this.db.query('DELETE FROM stop_requests WHERE owner=?').run(owner)
    this.db.query('DELETE FROM lease WHERE owner=?').run(owner)
  }
}
