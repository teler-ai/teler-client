import { z } from 'zod'
import type { CredentialStore } from '../credentials'
import type { LinkPairing } from './api'

const pairingSchema = z.object({
  deviceId: z.string().regex(/^lnkdev_[0-9a-z]{26}$/),
  secret: z.string().regex(/^tlk_[A-Za-z0-9_-]{43}$/),
  organizationId: z.string().min(1),
})

/** The helper's pairing lives beside the CLI sign-in, in the same store, under its own key. */
function resourceOf(origin: string): string {
  return `${origin}#link`
}

export async function readPairing(
  store: CredentialStore,
  origin: string
): Promise<LinkPairing | null> {
  const raw = await store.get(resourceOf(origin))
  if (!raw) return null
  try {
    return pairingSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function writePairing(
  store: CredentialStore,
  origin: string,
  pairing: LinkPairing
): Promise<void> {
  await store.set(resourceOf(origin), JSON.stringify(pairingSchema.parse(pairing)))
}

export async function deletePairing(store: CredentialStore, origin: string): Promise<void> {
  await store.delete(resourceOf(origin))
}

/**
 * Managed mode (`TELER_LINK_MANAGED=1`): an application such as Teler Desktop keeps the pairing
 * itself and hands it to `teler link` in `TELER_LINK_PAIRING`; the credential store is not used.
 */
export function isManaged(env: NodeJS.ProcessEnv): boolean {
  return env.TELER_LINK_MANAGED?.trim() === '1'
}

/** The supervisor's pairing, or null when it is missing or not valid. */
export function managedPairing(env: NodeJS.ProcessEnv): LinkPairing | null {
  const raw = env.TELER_LINK_PAIRING?.trim()
  if (!raw) return null
  try {
    return pairingSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}
