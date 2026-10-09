import { Button } from '../ui/button'
import { FolderPlus } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  FolderRequest,
  OrganizationSummary,
  SyncedFolder,
  SyncTarget,
} from '../../shared/desktop-api'
import { useDesktopApi } from '../desktop-api-context'
import { AddFolderDialog } from './add-folder-dialog'
import { FolderRow } from './folder-row'
import { SectionCard } from './section-card'

interface FoldersSectionProps {
  folders: SyncedFolder[]
  connected: boolean
  /** "Sync a folder" from the Teler web app, waiting to open the picker. */
  folderRequest: FolderRequest | null
  organizations: OrganizationSummary[]
  activeOrganizationId: string | null
  throttledUntil: number | null
  syncPaused: boolean
}

interface Draft {
  path: string
  target: SyncTarget | null
  /** Bumped per opening so every dialog starts from a fresh draft. */
  key: number
}

export function FoldersSection({
  folders,
  connected,
  folderRequest,
  organizations,
  activeOrganizationId,
  throttledUntil,
  syncPaused,
}: FoldersSectionProps) {
  const { t } = useTranslation()
  const api = useDesktopApi()
  const hintId = useId()
  const [choosing, setChoosing] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  // Survives re-renders and StrictMode's repeated effects, so each request
  // opens the picker once.
  const handledRequests = useRef(new Set<number>())

  const pickFolder = useCallback(
    async (target: SyncTarget | null, requestId?: number) => {
      setChoosing(true)
      try {
        const picking = api.chooseFolder()
        if (requestId !== undefined) {
          // The picker is open, so the request is handled even if it is cancelled.
          api.dismissFolderRequest(requestId).catch(() => undefined)
        }
        const path = await picking
        if (path) setDraft((current) => ({ path, target, key: (current?.key ?? 0) + 1 }))
      } catch {
        // A failed picker behaves like a cancelled one.
      } finally {
        setChoosing(false)
      }
    },
    [api]
  )

  // A request waits until sync is connected and no picker or dialog is open.
  useEffect(() => {
    if (!folderRequest || !connected || choosing || draft) return
    if (handledRequests.current.has(folderRequest.id)) return
    handledRequests.current.add(folderRequest.id)
    void pickFolder(folderRequest.target, folderRequest.id)
  }, [folderRequest, connected, choosing, draft, pickFolder])

  const addButton = (
    <Button
      ref={addRef}
      size="sm"
      loading={choosing}
      disabled={!connected || choosing}
      aria-describedby={connected ? undefined : hintId}
      onClick={() => void pickFolder(null)}
    >
      <FolderPlus aria-hidden="true" />
      {t('folders.add')}
    </Button>
  )

  return (
    <SectionCard title={t('folders.title')} action={addButton}>
      {!connected && (
        <p id={hintId} className="text-muted-foreground text-sm">
          {t('folders.addDisabledHint')}
        </p>
      )}
      {folders.length === 0 ? (
        <div className="border-border flex flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-8 text-center">
          <p className="text-foreground font-medium">{t('folders.empty')}</p>
          <p className="text-muted-foreground text-sm">{t('folders.emptyBody')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              organizations={organizations}
              throttledUntil={throttledUntil}
              syncPaused={syncPaused}
            />
          ))}
        </ul>
      )}
      {draft && (
        <AddFolderDialog
          key={draft.key}
          initialPath={draft.path}
          target={draft.target}
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
          returnFocusRef={addRef}
          onClose={() => setDraft(null)}
        />
      )}
    </SectionCard>
  )
}
