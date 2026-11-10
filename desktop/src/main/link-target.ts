import { ORGANIZATION_ID } from './sync-target'

/**
 * "Run my chats on this computer" in the Teler web app (Agent controls › Teler Link) navigates to
 * `teler-desktop://link-pair?organizationId=…`, which the main window intercepts like
 * "Sync a folder". Returns the organization to pair this computer with, or null for anything else.
 */
export function parseLinkPairAction(url: string): { organizationId: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'teler-desktop:' || parsed.hostname !== 'link-pair') return null
  const organizationId = parsed.searchParams.get('organizationId')
  if (!organizationId || !ORGANIZATION_ID.test(organizationId)) return null
  return { organizationId }
}
