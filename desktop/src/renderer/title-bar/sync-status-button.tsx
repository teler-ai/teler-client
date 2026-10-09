import { cn } from '../lib/utils'
import { Button } from '../ui/button'
import {
  CircleCheck,
  CirclePause,
  CircleX,
  FolderPlus,
  KeyRound,
  RefreshCw,
  TriangleAlert,
  Unplug,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SyncHealth } from '../../shared/desktop-api'

interface HealthPill {
  icon: LucideIcon
  /** Semantic text token for the icon; the label itself stays `foreground`. */
  tone: string
  /**
   * Key of the short label in `titleBar.status` and of the full sentence in
   * `health` (shared with the Synced folders status banner).
   */
  key: string
}

// Same icons as the Synced folders status banner, so both read alike.
const HEALTH: Record<SyncHealth, HealthPill> = {
  'up-to-date': { icon: CircleCheck, tone: 'text-success', key: 'upToDate' },
  syncing: { icon: RefreshCw, tone: 'text-primary', key: 'syncing' },
  paused: { icon: CirclePause, tone: 'text-muted-foreground', key: 'paused' },
  attention: { icon: TriangleAlert, tone: 'text-warning', key: 'attention' },
  'sign-in-required': { icon: KeyRound, tone: 'text-warning', key: 'signInRequired' },
  offline: { icon: WifiOff, tone: 'text-warning', key: 'offline' },
  stopped: { icon: CircleX, tone: 'text-destructive', key: 'stopped' },
  'no-folders': { icon: FolderPlus, tone: 'text-muted-foreground', key: 'noFolders' },
  'not-connected': { icon: Unplug, tone: 'text-muted-foreground', key: 'notConnected' },
}

interface SyncStatusButtonProps {
  health: SyncHealth
  pendingFiles: number
  /** The Synced folders page is open; pressing again returns to Teler. */
  pressed: boolean
  onToggle: () => void
}

/**
 * The sync status pill: shows the overall health and toggles the Synced
 * folders page, so its name stays the same whether it is pressed or not.
 */
export function SyncStatusButton({
  health,
  pendingFiles,
  pressed,
  onToggle,
}: SyncStatusButtonProps) {
  const { t } = useTranslation()
  const pill = HEALTH[health]
  const Icon = pill.icon
  const counting = health === 'syncing' && pendingFiles > 0
  const label = counting
    ? t('titleBar.status.syncingPending', { count: pendingFiles })
    : t(`titleBar.status.${pill.key}`)
  const hint =
    health !== 'syncing'
      ? t(`health.${pill.key}`)
      : counting
        ? t('health.syncing', { count: pendingFiles })
        : t('health.syncingFolders')

  return (
    <Button
      variant="secondary"
      size="sm"
      data-health={health}
      // The name contains the visible label, so voice control matches it.
      aria-label={t('titleBar.statusButton', { status: label })}
      aria-pressed={pressed}
      title={hint}
      onClick={onToggle}
      // Pressed reads as "you are here" with semantic tokens in every theme.
      className="app-region-no-drag aria-pressed:bg-primary/15 aria-pressed:text-foreground aria-pressed:inset-ring-primary/40 max-w-64 min-w-0 shrink aria-pressed:inset-ring-1"
    >
      <Icon
        aria-hidden="true"
        className={cn(pill.tone, health === 'syncing' && 'motion-safe:animate-spin')}
      />
      <span className="truncate">{label}</span>
    </Button>
  )
}
