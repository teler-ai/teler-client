import { rm } from 'node:fs/promises'
import { z } from 'zod'
import { readSealed, writeSealed, type Encryption } from './credential-store'
import { LinkError, PAIRING_CODE, type LinkProblem } from './link-api'
import type { CliRunner } from './sync-cli'
import { ORGANIZATION_ID } from './sync-target'

/** What runs the helper's chats: one entry per engine account `teler link pair` found. */
export interface LinkEngineReport {
  engine: string
  signedIn: boolean
}

export interface LinkPairResult {
  deviceId: string
  organizationId: string
  secret: string
  engines: LinkEngineReport[]
}

const DEVICE_ID = /^lnkdev_[0-9a-z]{26}$/
const SECRET = /^tlk_[A-Za-z0-9_-]{43}$/
/** Detecting the engines runs them; give slow first starts room. */
const PAIR_TIMEOUT_MS = 120_000

const pairOutputSchema = z.object({
  paired: z.literal(true),
  deviceId: z.string().regex(DEVICE_ID),
  organizationId: z.string().regex(ORGANIZATION_ID),
  secret: z.string().regex(SECRET),
  engines: z.array(z.object({ engine: z.string(), signedIn: z.boolean() })),
})
const errorOutputSchema = z.object({
  error: z.object({ code: z.string(), status: z.number().optional() }),
})

function lastLine(text: string): unknown {
  const line = text.trim().split('\n').at(-1)
  try {
    return line ? (JSON.parse(line) as unknown) : null
  } catch {
    return null
  }
}

function problemOf(stderr: string, timedOut: boolean): LinkProblem {
  if (timedOut) return 'network'
  const parsed = errorOutputSchema.safeParse(lastLine(stderr))
  if (!parsed.success) return 'failed'
  const { code, status } = parsed.data.error
  if (code === 'LINK_RESTRICTED') return 'link-restricted'
  if (code === 'LINK_DISABLED') return 'link-off'
  if (code === 'CLIENT_UPDATE_REQUIRED' || status === 426) return 'update-required'
  if (status === 429 || (status !== undefined && status >= 500)) return 'network'
  return 'failed'
}

/**
 * `teler link pair <code> --name <name> --json` in managed mode: the sidecar pairs this computer
 * and prints the pairing secret on stdout for the app to keep, instead of storing it itself.
 * Output is parsed, never logged, and never part of an error.
 */
export async function pairWithSidecar(
  runner: CliRunner,
  code: string,
  name: string
): Promise<LinkPairResult> {
  if (!PAIRING_CODE.test(code)) throw new LinkError('failed')
  const result = await runner.run(['link', 'pair', code, '--name', name, '--json'], {
    timeoutMs: PAIR_TIMEOUT_MS,
  })
  if (result.exitCode !== 0) throw new LinkError(problemOf(result.stderr, result.timedOut === true))
  const parsed = pairOutputSchema.safeParse(lastLine(result.stdout))
  if (!parsed.success) throw new LinkError('failed')
  const { deviceId, organizationId, secret, engines } = parsed.data
  return { deviceId, organizationId, secret, engines }
}

const storedSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  /** The Teler account that paired: the helper runs only while it is signed in to the window. */
  userId: z.string().min(1),
  deviceId: z.string().regex(DEVICE_ID),
  organizationId: z.string().regex(ORGANIZATION_ID),
  secret: z.string().regex(SECRET),
})

export type StoredLinkPairing = Omit<z.infer<typeof storedSchema>, 'version'>

/**
 * This computer's Teler Link pairing, one per origin. Like the sync token it is persisted only
 * through OS-backed encryption; without a keyring it lives in memory until the app quits.
 */
export class LinkPairingStore {
  private memory: StoredLinkPairing | null = null

  constructor(
    private readonly file: string,
    private readonly encryption: Encryption
  ) {}

  async read(origin: string): Promise<StoredLinkPairing | null> {
    if (this.memory) return this.memory.origin === origin ? this.memory : null
    const parsed = storedSchema.safeParse(await readSealed(this.file, this.encryption))
    if (!parsed.success || parsed.data.origin !== origin) return null
    const { version: _version, ...pairing } = parsed.data
    this.memory = pairing
    return pairing
  }

  async write(pairing: StoredLinkPairing): Promise<void> {
    this.memory = pairing
    await writeSealed(this.file, this.encryption, { version: 1, ...pairing })
  }

  async clear(): Promise<void> {
    this.memory = null
    await rm(this.file, { force: true })
  }
}
