import { z } from 'zod'
import type { FetchLike } from './device-login'

/**
 * Teler Link from Teler Desktop: the main process makes a one-time pairing code and removes this
 * computer with the session of the Teler window, the same requests Agent controls › Teler Link
 * makes. The pairing secret itself comes from the sidecar (`teler link pair`), never from here.
 */

/** Why setting up or removing Teler Link failed, shown to the person as plain next steps. */
export type LinkProblem =
  /** No Teler session in the window. */
  | 'signed-out'
  /** An owner or admin has not turned Teler Link on for the organization. */
  | 'link-off'
  /** The organization's data settings do not allow Teler Link. */
  | 'link-restricted'
  /** The account is not a member of the organization the page asked for. */
  | 'not-member'
  /** Teler needs a newer Teler Desktop. */
  | 'update-required'
  | 'network'
  | 'failed'

export class LinkError extends Error {
  constructor(readonly problem: LinkProblem) {
    super(`Teler Link setup failed: ${problem}`)
    this.name = 'LinkError'
  }
}

/** Codes are short letters, digits and dashes; anything else never reaches the sidecar's arguments. */
export const PAIRING_CODE = /^[0-9A-Za-z][0-9A-Za-z-]{3,31}$/

const codeSchema = z.object({
  success: z.literal(true),
  data: z.object({ code: z.string().regex(PAIRING_CODE) }),
})
const refusalSchema = z.object({ code: z.string() })

async function send(fetch: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    })
  } catch {
    throw new LinkError('network')
  }
}

/** A refusal's problem: signed out (401, or a redirect to sign-in from a proxy), and so on. */
async function problemOf(response: Response): Promise<LinkProblem> {
  if (
    response.status === 401 ||
    response.type === 'opaqueredirect' ||
    (response.status >= 300 && response.status < 400)
  )
    return 'signed-out'
  if (response.status === 403) return 'not-member'
  if (response.status === 409) {
    const body = refusalSchema.safeParse(await response.json().catch(() => null))
    return body.success && body.data.code === 'LINK_RESTRICTED' ? 'link-restricted' : 'link-off'
  }
  if (response.status === 426) return 'update-required'
  return response.status >= 500 || response.status === 429 ? 'network' : 'failed'
}

/** A one-time code that pairs a computer and runs the member's chats on it. */
export async function createPairingCode(
  origin: string,
  organizationId: string,
  fetch: FetchLike
): Promise<string> {
  const response = await send(fetch, `${origin}/api/link/pairing-codes`, {
    method: 'POST',
    body: JSON.stringify({ organizationId, useForChatTurns: true }),
  })
  if (!response.ok) throw new LinkError(await problemOf(response))
  const parsed = codeSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new LinkError('failed')
  return parsed.data.data.code
}

/** Removes a paired computer from Teler. One that is already gone counts as removed. */
export async function revokeLinkDevice(
  origin: string,
  device: { deviceId: string; organizationId: string },
  fetch: FetchLike
): Promise<void> {
  const response = await send(
    fetch,
    `${origin}/api/link/devices/${encodeURIComponent(device.deviceId)}?organizationId=${encodeURIComponent(device.organizationId)}`,
    { method: 'DELETE' }
  )
  if (response.ok || response.status === 404) return
  throw new LinkError(await problemOf(response))
}
