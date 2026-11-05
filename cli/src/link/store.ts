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
