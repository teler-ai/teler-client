import { FileText, Info } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { FolderPreview } from '../../shared/desktop-api'
import { formatBytes } from '../lib/format'

export function FolderPreviewSummary({ preview }: { preview: FolderPreview }) {
  const { t, i18n } = useTranslation()
  const sampleId = useId()
  const { excluded, unsupported, other } = preview.skipped
  const skipped = [
    excluded > 0 && t('addFolder.skippedExcluded', { count: excluded }),
    unsupported > 0 && t('addFolder.skippedUnsupported', { count: unsupported }),
    other > 0 && t('addFolder.skippedOther', { count: other }),
  ].filter((line): line is string => typeof line === 'string')
  const remaining = preview.fileCount - preview.sampleFiles.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-foreground font-medium" data-testid="preview-summary">
          {preview.fileCount > 0
            ? t('addFolder.summary', {
                count: preview.fileCount,
                size: formatBytes(preview.totalBytes, i18n.language),
              })
            : t('addFolder.nothingToUpload')}
        </p>
        <p className="text-muted-foreground text-sm">
          {t('addFolder.uploadsTo')}{' '}
          <span className="text-foreground font-data text-xs">{preview.destination}</span>
        </p>
      </div>

      {preview.sampleFiles.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 id={sampleId} className="text-foreground text-sm font-medium">
            {t('addFolder.sampleTitle')}
          </h3>
          {/* Focusable so keyboard users can scroll a long sample. */}
          <ul
            aria-labelledby={sampleId}
            tabIndex={0}
            className="border-border bg-muted/30 focus-visible:ring-ring max-h-32 overflow-y-auto rounded-md border px-3 py-2 outline-none focus-visible:ring-2"
          >
            {preview.sampleFiles.map((file) => (
              <li key={file} className="text-foreground flex items-center gap-2 py-0.5 text-xs">
                <FileText aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
                <span className="font-data truncate" title={file}>
                  {file}
                </span>
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <p className="text-muted-foreground text-xs">
              {t('addFolder.sampleMore', { count: remaining })}
            </p>
          )}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-foreground text-sm font-medium">{t('addFolder.skippedTitle')}</h3>
          <ul className="text-muted-foreground list-inside list-disc text-sm">
            {skipped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-muted-foreground flex gap-2 text-xs">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {t('addFolder.exclusionsNote')}
      </p>
    </div>
  )
}
