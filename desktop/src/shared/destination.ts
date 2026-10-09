export type DestinationScope = 'personal' | 'organization'

const SCOPE_PATTERN = /^\/(personal|organization)(\/|$)/
// Teler folder paths: no control characters or backslashes. `/` separates
// segments.
const INVALID_SEGMENT = /\\|\p{Cc}/u

function validSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !INVALID_SEGMENT.test(segment)
}

/**
 * Builds the remote destination for a synced folder. The folder name is a
 * single path segment, so a user cannot escape the chosen scope.
 */
export function buildDestination(scope: DestinationScope, folderName: string): string | null {
  const name = folderName.trim()
  if (name.includes('/') || !validSegment(name)) return null
  return `/${scope}/${name}`
}

/**
 * Validates a destination: inside `/personal` or `/organization` like
 * `teler sync --to`, with segments the server accepts (no `.`/`..`, control
 * characters or backslashes, and no empty segments).
 */
export function isValidDestination(destination: string): boolean {
  if (!SCOPE_PATTERN.test(destination)) return false
  return destination.split('/').slice(1).every(validSegment)
}

export function destinationScope(destination: string): DestinationScope {
  return destination.startsWith('/organization') ? 'organization' : 'personal'
}
