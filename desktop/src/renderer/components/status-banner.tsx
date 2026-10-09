import { Button } from '../ui/button'
import { cn } from '../lib/utils'
import {
  CircleCheck,
  CirclePause,
  CircleX,
  Clock,
  FolderPlus,
  KeyRound,
  RefreshCw,
  TriangleAlert,
  Unplug,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncHealth } from '../../shared/desktop-api'
import { useDesktopApi } from '../desktop-api-context'

type Tone = 'success' | 'progress' | 'neutral' | 'warning' | 'danger'

interface HealthCopy {
  icon: LucideIcon
  tone: Tone
  titleKey: string
  detailKey: string
}

const HEALTH: Record<SyncHealth, HealthCopy> = {
  'up-to-date': {
    icon: CircleCheck,
    tone: 'success',
    titleKey: 'upToDate',
    detailKey: 'upToDateDetail',
  },
  syncing: { icon: RefreshCw, tone: 'progress', titleKey: 'syncing', detailKey: 'syncingDetail' },
  paused: { icon: CirclePause, tone: 'neutral', titleKey: 'paused', detailKey: 'pausedDetail' },
  attention: {
    icon: TriangleAlert,
    tone: 'warning',
    titleKey: 'attention',
    detailKey: 'attentionDetail',
  },
  'sign-in-required': {
    icon: KeyRound,
    tone: 'warning',
    titleKey: 'signInRequired',
    detailKey: 'signInRequiredDetail',
  },
  offline: { icon: WifiOff, tone: 'warning', titleKey: 'offline', detailKey: 'offlineDetail' },
  stopped: { icon: CircleX, tone: 'danger', titleKey: 'stopped', detailKey: 'stoppedDetail' },
  'no-folders': {
    icon: FolderPlus,
    tone: 'neutral',
    titleKey: 'noFolders',
    detailKey: 'noFoldersDetail',
  },
  'not-connected': {
    icon: Unplug,
    tone: 'neutral',
    titleKey: 'notConnected',
    detailKey: 'notConnectedDetail',
  },
}

// Token pairs (`bg-x` with `text-x-foreground`) keep icon contrast in every theme.
const TONE_CLASSES: Record<Tone, { frame: string; chip: string }> = {
  success: { frame: 'border-success/40 bg-success/10', chip: 'bg-success text-success-foreground' },
  progress: {
    frame: 'border-primary/40 bg-primary/10',
    chip: 'bg-primary text-primary-foreground',
  },
  neutral: { frame: 'border-border bg-muted/60', chip: 'bg-secondary text-secondary-foreground' },
  warning: { frame: 'border-warning/50 bg-warning/10', chip: 'bg-warning text-warning-foreground' },
  danger: {
    frame: 'border-destructive/40 bg-destructive/10',
    chip: 'bg-destructive text-destructive-foreground',
  },
}

// Files that retry on their own after a temporary failure: progress, not a problem.
const WAITING: HealthCopy = {
  icon: Clock,
  tone: 'progress',
  titleKey: 'waiting',
  detailKey: 'waitingDetail',
}

interface StatusBannerProps {
  health: SyncHealth
  pendingFiles: number
  /** Files retrying automatically after a temporary failure. */
  waitingFiles: number
}

export function StatusBanner({ health, pendingFiles, waitingFiles }: StatusBannerProps) {
  const { t } = useTranslation()
  const api = useDesktopApi()
  const [pending, setPending] = useState(false)
  // Only waiting files are left: say so instead of "syncing" or "up to date".
  const onlyWaiting =
    (health === 'syncing' || health === 'up-to-date') && pendingFiles === 0 && waitingFiles > 0
  const copy = onlyWaiting ? WAITING : HEALTH[health]
  const tone = TONE_CLASSES[copy.tone]
  const Icon = copy.icon
  const title = onlyWaiting
    ? t('health.waiting', { count: waitingFiles })
    : health !== 'syncing'
      ? t(`health.${copy.titleKey}`)
      : pendingFiles > 0
        ? t('health.syncing', { count: pendingFiles })
        : t('health.syncingFolders')

  const run = async (action: () => Promise<unknown>) => {
    setPending(true)
    try {
      await action()
    } catch {
      // Failures surface through the pushed state (health and connection).
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      data-testid="status-banner"
      data-health={health}
      className={cn('flex items-center gap-3 rounded-lg border p-4', tone.frame)}
    >
      <span
        aria-hidden="true"
        className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', tone.chip)}
      >
        <Icon
          className={cn(
            'size-5',
            health === 'syncing' && !onlyWaiting && 'motion-safe:animate-spin'
          )}
        />
      </span>
      <div role="status" className="min-w-0 flex-1">
        <p className="text-foreground font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{t(`health.${copy.detailKey}`)}</p>
      </div>
      {health === 'paused' && (
        <Button
          size="sm"
          loading={pending}
          onClick={() => void run(() => api.setSyncPaused(false))}
        >
          {t('health.resume')}
        </Button>
      )}
      {health === 'sign-in-required' && (
        <Button size="sm" loading={pending} onClick={() => void run(() => api.connect())}>
          {t('health.reconnect')}
        </Button>
      )}
    </div>
  )
}
