import { Badge, type BadgeProps } from '../ui/badge'
import { ArrowRight, Folder } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DesktopErrorCode,
  DesktopResult,
  FolderStatus,
  OrganizationSummary,
  SyncedFolder,
} from '../../shared/desktop-api'
import { destinationScope } from '../../shared/destination'
import { useDesktopApi } from '../desktop-api-context'
import { truncateMiddle } from '../lib/format'
import { ConfirmDialog } from './confirm-dialog'
import { FolderActions } from './folder-actions'
import { ProblemFiles } from './problem-files'
import { WaitingFiles } from './waiting-files'

const STATUS_BADGE: Record<FolderStatus, NonNullable<BadgeProps['variant']>> = {
  pending: 'info',
  ready: 'success',
  paused: 'secondary',
  attention: 'warning',
  'sign-in-required': 'warning',
  offline: 'outline',
  unavailable: 'destructive',
  'other-account': 'warning',
}

function useCountsLine(folder: SyncedFolder): string {
  const { t } = useTranslation()
  const { synced, pending, problems } = folder.counts
  const parts = [
    synced > 0 && t('folders.synced', { count: synced }),
    pending > 0 && t('folders.pending', { count: pending }),
    problems > 0 && t('folders.problems', { count: problems }),
  ].filter((part): part is string => typeof part === 'string')
  return parts.length > 0 ? parts.join(' · ') : t('folders.noFiles')
}

/** "Acme · Q3 Plan project · Personal files / Reports" */
function useDestinationLine(folder: SyncedFolder, organizations: OrganizationSummary[]): string {
  const { t } = useTranslation()
  const organization =
    organizations.find((candidate) => candidate.id === folder.organizationId)?.name ??
    t('folders.organizationFallback')
  const scope =
    destinationScope(folder.destination) === 'organization'
      ? t('folders.scopeOrganization')
      : t('folders.scopePersonal')
  const remotePath = folder.destination.replace(/^\/(personal|organization)\/?/, '')
  return [
    organization,
    folder.projectName && t('folders.project', { name: folder.projectName }),
    remotePath ? `${scope} / ${remotePath}` : scope,
  ]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ')
}

interface FolderRowProps {
  folder: SyncedFolder
  organizations: OrganizationSummary[]
  throttledUntil: number | null
  /** Sync is paused for every folder. */
  syncPaused: boolean
}

type PendingAction = 'menu' | 'retry' | null

export function FolderRow({ folder, organizations, throttledUntil, syncPaused }: FolderRowProps) {
  const { t } = useTranslation()
  const api = useDesktopApi()
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [error, setError] = useState<DesktopErrorCode | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const actionsRef = useRef<HTMLButtonElement>(null)
  const counts = useCountsLine(folder)
  const destination = useDestinationLine(folder, organizations)

  const run = async (
    action: () => Promise<DesktopResult<null>>,
    kind: Exclude<PendingAction, null> = 'menu'
  ) => {
    setPendingAction(kind)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) setError(result.error)
    } catch {
      setError('sync-failed')
    } finally {
      setPendingAction(null)
    }
  }

  const togglePause = () =>
    void run(() =>
      folder.status === 'paused' ? api.resumeFolder(folder.id) : api.pauseFolder(folder.id)
    )

  return (
    <li className="border-border flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <Folder aria-hidden="true" className="text-muted-foreground mt-0.5 size-5 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-foreground truncate font-sans text-base font-semibold">
              {folder.name}
            </h3>
            <Badge variant={STATUS_BADGE[folder.status]}>
              {t(`folders.status.${folder.status}`)}
            </Badge>
          </div>
          <p className="text-muted-foreground min-w-0 text-xs">
            <span aria-hidden="true" title={folder.localPath} className="font-data block truncate">
              {truncateMiddle(folder.localPath, 64)}
            </span>
            <span className="sr-only">{folder.localPath}</span>
          </p>
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
            <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only">{t('folders.syncsTo')}</span>
            <span className="min-w-0 truncate" title={destination}>
              {destination}
            </span>
          </p>
          <p className="text-foreground text-sm">{counts}</p>
          {folder.counts.waiting > 0 && (
            <WaitingFiles
              folder={folder}
              throttledUntil={throttledUntil}
              retryAllowed={!syncPaused && folder.status !== 'paused'}
              retrying={pendingAction === 'retry'}
              onRetry={() => void run(() => api.retryFolder(folder.id), 'retry')}
            />
          )}
          {folder.status === 'other-account' && (
            <p className="text-muted-foreground text-sm">{t('folders.otherAccountHint')}</p>
          )}
          <ProblemFiles files={folder.problemFiles} total={folder.counts.problems} />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {t(`errors.${error}`)}
            </p>
          )}
        </div>
        <FolderActions
          folder={folder}
          busy={pendingAction !== null}
          onTogglePause={togglePause}
          onReveal={() => void api.revealFolder(folder.id)}
          onRemove={() => setConfirmRemove(true)}
          triggerRef={actionsRef}
        />
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('folders.removeTitle', { name: folder.name })}
        description={t('folders.removeBody')}
        confirmLabel={t('folders.remove')}
        onConfirm={() => run(() => api.removeFolder(folder.id))}
        returnFocusRef={actionsRef}
      />
    </li>
  )
}
