import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { EllipsisVertical, FolderOpen, Pause, Play, Trash2 } from 'lucide-react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncedFolder } from '../../shared/desktop-api'

interface FolderActionsProps {
  folder: SyncedFolder
  busy: boolean
  onTogglePause: () => void
  onReveal: () => void
  onRemove: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

export function FolderActions({
  folder,
  busy,
  onTogglePause,
  onReveal,
  onRemove,
  triggerRef,
}: FolderActionsProps) {
  const { t } = useTranslation()
  const paused = folder.status === 'paused'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={t('folders.actions', { name: folder.name })}
        >
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onTogglePause}>
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {paused ? t('folders.resume') : t('folders.pause')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReveal}>
          <FolderOpen aria-hidden="true" />
          {t('folders.reveal')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          <Trash2 aria-hidden="true" />
          {t('folders.remove')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
