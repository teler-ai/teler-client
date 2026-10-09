import { describe, expect, it } from 'vitest'
import { describeRetryTime, formatBytes, truncateMiddle } from '../../src/renderer/lib/format'
import { commonWaitingReason, waitingReasonKey } from '../../src/renderer/lib/waiting-reason'

const NOW = new Date('2026-10-06T09:00:00Z').getTime()

describe('format', () => {
  it('pluralises bytes and abbreviates larger sizes', () => {
    expect(formatBytes(22, 'en')).toBe('22 bytes')
    expect(formatBytes(1, 'en')).toBe('1 byte')
    expect(formatBytes(1_250_000, 'en')).toBe('1.3 MB')
  })

  it('truncates long paths in the middle', () => {
    const truncated = truncateMiddle('/Users/ana/Documents/Reports/2026/Quarterly', 20)
    expect(truncated).toBe('/Users/ana…Quarterly')
    expect(truncated).toHaveLength(20)
  })

  it('describes a retry relative to now within the hour and as a clock time after', () => {
    expect(describeRetryTime(NOW - 1, NOW, 'en')).toEqual({ kind: 'now' })
    expect(describeRetryTime(NOW + 400, NOW, 'en')).toEqual({
      kind: 'relative',
      text: 'in 1 second',
    })
    expect(describeRetryTime(NOW + 45_000, NOW, 'en')).toEqual({
      kind: 'relative',
      text: 'in 45 seconds',
    })
    // Just under a minute reads as a minute, never "in 60 seconds".
    expect(describeRetryTime(NOW + 59_700, NOW, 'en')).toEqual({
      kind: 'relative',
      text: 'in 1 minute',
    })
    expect(describeRetryTime(NOW + 59 * 60_000, NOW, 'es')).toEqual({
      kind: 'relative',
      text: 'dentro de 59 minutos',
    })
    const later = NOW + 60 * 60_000
    expect(describeRetryTime(later, NOW, 'en')).toEqual({
      kind: 'clock',
      text: new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(later),
    })
  })
})

describe('waiting reasons', () => {
  it('maps Teler error codes to copy keys and anything else to a generic failure', () => {
    expect(waitingReasonKey('RATE_LIMITED')).toBe('rateLimited')
    expect(waitingReasonKey('HTTP_429')).toBe('rateLimited')
    expect(waitingReasonKey('NETWORK')).toBe('network')
    expect(waitingReasonKey('UPLOAD_NOT_CONFIGURED')).toBe('notConfigured')
    expect(waitingReasonKey('STORAGE_QUOTA_EXCEEDED')).toBe('storageFull')
    expect(waitingReasonKey('INGEST_IN_PROGRESS')).toBe('processing')
    expect(waitingReasonKey('SYNC_NOT_READY')).toBe('processing')
    expect(waitingReasonKey('HTTP_500')).toBe('serverError')
    expect(waitingReasonKey('HTTP_504')).toBe('serverError')
    expect(waitingReasonKey('HTTP_404')).toBe('failed')
    expect(waitingReasonKey('UNKNOWN')).toBe('failed')
    expect(waitingReasonKey(null)).toBe('failed')
  })

  it('summarises a folder by its most common reason, preferring the sooner retry on a tie', () => {
    const file = (reason: string | null) => ({
      relativePath: 'x',
      status: 'retrying',
      retryAt: null,
      reason,
    })
    expect(commonWaitingReason([])).toBeNull()
    expect(commonWaitingReason([file('NETWORK'), file('RATE_LIMITED'), file('HTTP_429')])).toBe(
      'rateLimited'
    )
    expect(commonWaitingReason([file('NETWORK'), file('RATE_LIMITED')])).toBe('network')
  })
})
