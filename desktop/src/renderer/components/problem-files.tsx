import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProblemFile } from '../../shared/desktop-api'
import { cn } from '../lib/utils'
import { waitingReasonKey } from '../lib/waiting-reason'

const KNOWN_PROBLEMS = new Set(['failed', 'conflict', 'retrying', 'unreadable'])

interface ProblemFilesProps {
  files: ProblemFile[]
  /** Total files that need attention; can exceed the listed sample. */
  total: number
}

export function ProblemFiles({ files, total }: ProblemFilesProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const listId = useId()
  if (files.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
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
        {open
          ? t('folders.hideProblems')
          : t('folders.showProblems', { count: Math.max(total, files.length) })}
      </button>
      {open && (
        <ul id={listId} className="border-border divide-border divide-y rounded-md border text-sm">
          {files.map((file) => (
            <li
              key={file.relativePath}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span
                className="text-foreground font-data min-w-0 truncate text-xs"
                title={file.relativePath}
              >
                {file.relativePath}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {t(
                  `folders.problemStatus.${KNOWN_PROBLEMS.has(file.status) ? file.status : 'other'}`
                )}
                {file.reason && waitingReasonKey(file.reason) !== 'failed'
                  ? ` · ${t(`folders.waitingReason.${waitingReasonKey(file.reason)}`)}`
                  : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
