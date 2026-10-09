import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

/** Electron `safeStorage`, behind an interface so tests need no Electron. */
export interface Encryption {
  isAvailable(): boolean
  encrypt(plainText: string): Buffer
  decrypt(cipherText: Buffer): string
}

const credentialSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  token: z.string().min(1),
  account: z.object({ id: z.string(), name: z.string().nullable() }),
})

export type StoredCredential = Omit<z.infer<typeof credentialSchema>, 'version'>

/**
 * Holds the folder-sync token. It is persisted only through OS-backed
 * encryption; without a keyring it lives in memory until the app quits.
 * The token is bound to the origin that issued it.
 */
export class CredentialStore {
  private memory: StoredCredential | null = null

  constructor(
    private readonly file: string,
    private readonly encryption: Encryption
  ) {}

  get persistence(): 'encrypted' | 'session' {
    return this.encryption.isAvailable() ? 'encrypted' : 'session'
  }

  async read(origin: string): Promise<StoredCredential | null> {
    if (this.memory) return this.memory.origin === origin ? this.memory : null
    if (!this.encryption.isAvailable()) return null
    try {
      const plain = this.encryption.decrypt(await readFile(this.file))
      const parsed = credentialSchema.safeParse(JSON.parse(plain) as unknown)
      if (!parsed.success || parsed.data.origin !== origin) return null
      const { origin: storedOrigin, token, account } = parsed.data
      this.memory = { origin: storedOrigin, token, account }
      return this.memory
    } catch {
      // Missing, unreadable or undecryptable credentials mean "not connected".
      return null
    }
  }

  async write(credential: StoredCredential): Promise<void> {
    this.memory = credential
    if (!this.encryption.isAvailable()) return
    const cipher = this.encryption.encrypt(JSON.stringify({ version: 1, ...credential }))
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, cipher, { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.file)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async clear(): Promise<void> {
    this.memory = null
    await rm(this.file, { force: true })
  }
}
