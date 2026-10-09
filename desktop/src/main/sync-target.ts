import type { SyncTarget } from '../shared/desktop-api'

/** Teler TypeIDs; the server still checks that the account can use them. */
export const ORGANIZATION_ID = /^org_[0-9a-hjkmnp-tv-z]{26}$/
export const PROJECT_ID = /^prj_[0-9a-hjkmnp-tv-z]{26}$/
const MAX_PROJECT_NAME = 200

/**
 * "Sync a folder" in the Teler web app navigates to
 * `teler-desktop://sync-folder?organizationId=…&projectId=…&projectName=…`,
 * which the main window intercepts. Returns null for anything else.
 */
export function parseSyncFolderAction(url: string): SyncTarget | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'teler-desktop:' || parsed.hostname !== 'sync-folder') return null
  const organizationId = parsed.searchParams.get('organizationId') || undefined
  const projectId = parsed.searchParams.get('projectId') || undefined
  const projectName = parsed.searchParams.get('projectName')?.trim().slice(0, MAX_PROJECT_NAME)
  if (organizationId && !ORGANIZATION_ID.test(organizationId)) return null
  if (projectId && (!organizationId || !PROJECT_ID.test(projectId))) return null
  return {
    ...(organizationId && { organizationId }),
    ...(projectId && { projectId, ...(projectName && { projectName }) }),
  }
}

/** Only Teler's own pages may ask for desktop actions, never a sign-in provider's. */
export function isTelerPage(pageUrl: string, origin: string): boolean {
  try {
    return new URL(pageUrl).origin === origin
  } catch {
    return false
  }
}
