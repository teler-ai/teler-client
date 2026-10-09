import type { SyncedFolder } from '../../shared/desktop-api'

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

/** Formats a byte count with decimal (SI) units, as Finder and Explorer do. */
export function formatBytes(bytes: number, locale: string): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: BYTE_UNITS[unit],
    // Short "byte" is not pluralised ("22 byte"); spell bytes out, abbreviate the rest.
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: unit > 0 && value < 10 ? 1 : 0,
  }).format(value)
}

/** Keeps both ends of a long path visible: `/Users/ana/…/Reports/2026`. */
export function truncateMiddle(text: string, maxLength = 52): string {
  if (text.length <= maxLength) return text
  const keep = maxLength - 1
  const head = Math.ceil(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`
}

/** Last segment of a local path on any platform. */
export function folderBasename(localPath: string): string {
  const segments = localPath.split(/[\\/]+/).filter(Boolean)
  return segments.at(-1) ?? ''
}

export function totalPending(folders: SyncedFolder[]): number {
  return folders.reduce((sum, folder) => sum + folder.counts.pending, 0)
}

export function totalWaiting(folders: SyncedFolder[]): number {
  return folders.reduce((sum, folder) => sum + folder.counts.waiting, 0)
}

/** A clock time such as `2:30 PM`, in the user's language. */
export function formatClock(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at)
}

export type RetryTime =
  | { kind: 'now' }
  /** Within the hour, such as `in 3 minutes`. */
  | { kind: 'relative'; text: string }
  /** An hour or more away: a clock time. */
  | { kind: 'clock'; text: string }

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** When a retry happens: relative while it is close, a clock time when an hour or more away. */
export function describeRetryTime(at: number, now: number, locale: string): RetryTime {
  const remaining = at - now
  if (remaining <= 0) return { kind: 'now' }
  if (remaining >= HOUR) return { kind: 'clock', text: formatClock(at, locale) }
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
  // Rounds to the nearest unit, so "in 3 minutes" covers 2.5 to 3.5 minutes.
  const text =
    remaining < MINUTE - 500
      ? relative.format(Math.max(1, Math.round(remaining / 1000)), 'second')
      : relative.format(Math.max(1, Math.round(remaining / MINUTE)), 'minute')
  return { kind: 'relative', text }
}
