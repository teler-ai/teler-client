import { cn } from '../lib/utils'
import { Button } from '../ui/button'
import { ChevronDown, Clock, RotateCw } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncedFolder } from '../../shared/desktop-api'
import { useNow } from '../hooks/use-now'
import { describeRetryTime, type RetryTime } from '../lib/format'
import { commonWaitingReason, waitingReasonKey } from '../lib/waiting-reason'

interface WaitingFilesProps {
  folder: SyncedFolder
  /** While Teler limits upload starts, nothing starts before this time. */
  throttledUntil: number | null
  /** False when retrying now cannot help, such as while the folder is paused. */
  retryAllowed: boolean
  retrying: boolean
  onRetry: () => void
}

/** The later of a retry time and the end of Teler's upload limit. */
function effectiveTime(at: number | null, throttledUntil: number | null, now: number) {
  if (throttledUntil === null || throttledUntil <= now) return at
  return at === null ? throttledUntil : Math.max(at, throttledUntil)
}

/**
 * Files that failed for a temporary reason and retry on their own: when the
 * next try happens, why, and a way to try now.
 */
export function WaitingFiles({
  folder,
  throttledUntil,
  retryAllowed,
  retrying,
  onRetry,
}: WaitingFilesProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const lineId = useId()
  const listId = useId()
  const latest = Math.max(
    folder.nextRetryAt ?? 0,
    throttledUntil ?? 0,
    ...folder.waitingFiles.map((file) => file.retryAt ?? 0)
  )
  const now = useNow(latest > 0 ? latest : null)
  const throttled = throttledUntil !== null && throttledUntil > now

  const when = (time: RetryTime) =>
    time.kind === 'now'
      ? t('folders.nextTryNow')
      : time.kind === 'clock'
        ? t('folders.nextTryAt', { time: time.text })
        : t('folders.nextTryIn', { relative: time.text })

  const next = effectiveTime(folder.nextRetryAt, throttledUntil, now)
  const reason = commonWaitingReason(folder.waitingFiles)
  const line = [
    t('folders.waiting', { count: folder.counts.waiting }),
    next !== null && when(describeRetryTime(next, now, i18n.language)),
    reason && t(`folders.waitingReason.${reason}`),
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' · ')

  return (
    <div className="flex flex-col gap-2">
      <p id={lineId} className="text-muted-foreground flex items-start gap-1.5 text-sm">
        <Clock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">{line}</span>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {retryAllowed && !throttled && (
          <Button
            variant="outline"
            size="sm"
            loading={retrying}
            disabled={retrying}
            aria-describedby={lineId}
            onClick={onRetry}
          >
            <RotateCw aria-hidden="true" />
            {t('folders.retryNow')}
          </Button>
        )}
        {folder.waitingFiles.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
            className="text-foreground focus-visible:ring-ring flex w-fit items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-4 motion-safe:transition-transform', open && 'rotate-180')}
            />
            {open ? t('folders.hideWaiting') : t('folders.showWaiting')}
          </button>
        )}
      </div>
      {open && (
        <ul id={listId} className="border-border divide-border divide-y rounded-md border text-sm">
          {folder.waitingFiles.map((file) => {
            const at = effectiveTime(file.retryAt, throttledUntil, now)
            return (
              <li
                key={file.relativePath}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2"
              >
                <span
                  className="text-foreground font-data min-w-0 truncate text-xs"
                  title={file.relativePath}
                >
                  {file.relativePath}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t(`folders.waitingReason.${waitingReasonKey(file.reason)}`)}
                  {at !== null && ` · ${when(describeRetryTime(at, now, i18n.language))}`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
