import { Alert, AlertDescription } from '../ui/alert'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { CircleAlert, Folder, FolderKanban } from 'lucide-react'
import { useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DesktopErrorCode,
  FolderInput,
  FolderPreview,
  OrganizationSummary,
  SyncTarget,
} from '../../shared/desktop-api'
import { buildDestination, type DestinationScope } from '../../shared/destination'
import { useDesktopApi } from '../desktop-api-context'
import { folderBasename } from '../lib/format'
import { DestinationFields } from './destination-fields'
import { FolderPreviewSummary } from './folder-preview-summary'
import { OrganizationField } from './organization-field'

interface AddFolderDialogProps {
  /** Folder picked before the dialog opened. */
  initialPath: string
  /** Set when the Teler web app asked to sync a folder into a project. */
  target?: SyncTarget | null
  organizations: OrganizationSummary[]
  /** The organization open in the Teler window, when known. */
  activeOrganizationId: string | null
  onClose: () => void
  /** The opener; it was disabled while the native picker was open. */
  returnFocusRef: RefObject<HTMLElement | null>
}

type Pending = 'choose' | 'preview' | 'add' | null

/** Where the folder syncs; the project name travels with its id for display. */
function syncIds(
  organizationId: string | null,
  target: SyncTarget | null | undefined
): Omit<FolderInput, 'localPath' | 'destination'> {
  return {
    ...(organizationId ? { organizationId } : {}),
    ...(target?.projectId
      ? {
          projectId: target.projectId,
          ...(target.projectName ? { projectName: target.projectName } : {}),
        }
      : {}),
  }
}

export function AddFolderDialog({
  initialPath,
  target,
  organizations,
  activeOrganizationId,
  onClose,
  returnFocusRef,
}: AddFolderDialogProps) {
  const { t } = useTranslation()
  const api = useDesktopApi()
  const [localPath, setLocalPath] = useState(initialPath)
  const [organizationId, setOrganizationId] = useState<string | null>(
    () => target?.organizationId ?? activeOrganizationId ?? organizations[0]?.id ?? null
  )
  const [scope, setScope] = useState<DestinationScope>('personal')
  const [name, setName] = useState(() => folderBasename(initialPath))
  const [preview, setPreview] = useState<FolderPreview | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [error, setError] = useState<DesktopErrorCode | null>(null)
  const [previewTimedOut, setPreviewTimedOut] = useState(false)
  // Each request gets a token; a newer request or closing invalidates it.
  const request = useRef(0)
  const formId = useId()
  const destination = buildDestination(scope, name)
  const ids = syncIds(organizationId, target)
  const projectLine = target?.projectId
    ? target.projectName
      ? t('addFolder.toProject', { name: target.projectName })
      : t('addFolder.toSelectedProject')
    : null

  const track = async <T,>(kind: Exclude<Pending, null>, task: () => Promise<T>) => {
    const token = ++request.current
    setPending(kind)
    setError(null)
    try {
      const value = await task()
      return token === request.current ? { value } : null
    } catch {
      if (token === request.current) setError('sync-failed')
      return null
    } finally {
      if (token === request.current) setPending(null)
    }
  }

  const chooseAnother = async () => {
    const result = await track('choose', () => api.chooseFolder())
    if (!result?.value) return
    setLocalPath(result.value)
    setName(folderBasename(result.value))
    setPreviewTimedOut(false)
  }

  const review = async (event: FormEvent) => {
    event.preventDefault()
    if (!destination || pending) return
    const result = await track('preview', () =>
      api.previewFolder({ localPath, destination, ...ids })
    )
    if (!result) return
    setPreviewTimedOut(!result.value.ok && result.value.error === 'timeout')
    if (result.value.ok) setPreview(result.value.value)
    else setError(result.value.error)
  }

  // Previewing reads every file, so a very large folder may time out; it can
  // then be added without a preview.
  const start = async () => {
    if (pending) return
    const input: FolderInput | null = preview
      ? { localPath: preview.localPath, destination: preview.destination, ...ids }
      : previewTimedOut && destination
        ? { localPath, destination, ...ids }
        : null
    if (!input) return
    const result = await track('add', () => api.addFolder(input))
    if (!result) return
    if (result.value.ok) onClose()
    else setError(result.value.error)
  }

  const close = (open: boolean) => {
    if (open || pending === 'add') return
    request.current += 1
    onClose()
  }

  const busy = pending !== null

  return (
    <Dialog open onOpenChange={close}>
      {/* Only the body scrolls, so the actions stay reachable in a short window. */}
      <DialogContent
        className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('addFolder.title')}</DialogTitle>
          <DialogDescription>{t('addFolder.description')}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pb-1">
          <div className="flex flex-col gap-2">
            <p className="text-foreground text-sm font-medium">{t('addFolder.localFolder')}</p>
            <div className="border-border flex items-center gap-2 rounded-md border px-3 py-2">
              <Folder aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
              <span className="font-data min-w-0 flex-1 truncate text-xs" title={localPath}>
                {localPath}
              </span>
            </div>
            {!preview && (
              <Button
                variant="link"
                size="sm"
                className="w-fit px-0"
                disabled={busy}
                onClick={() => void chooseAnother()}
              >
                {t('addFolder.chooseAnother')}
              </Button>
            )}
          </div>

          <OrganizationField
            organizations={organizations}
            value={organizationId}
            onChange={setOrganizationId}
            // A project belongs to one organization; a preview was made for one.
            fixed={Boolean(target?.projectId) || preview !== null}
            disabled={busy}
          />
          {projectLine && (
            <p className="text-foreground flex items-center gap-2 text-sm font-medium">
              <FolderKanban aria-hidden="true" className="text-primary size-4 shrink-0" />
              <span className="min-w-0 break-words">{projectLine}</span>
            </p>
          )}

          {preview ? (
            <FolderPreviewSummary preview={preview} />
          ) : (
            <form id={formId} onSubmit={(event) => void review(event)} noValidate>
              <DestinationFields
                scope={scope}
                onScopeChange={setScope}
                name={name}
                onNameChange={setName}
                destination={destination}
                disabled={busy}
              />
            </form>
          )}

          {error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" className="size-4" />
              <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          {preview ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPreview(null)
                  setError(null)
                }}
              >
                {t('addFolder.back')}
              </Button>
              <Button loading={pending === 'add'} disabled={busy} onClick={() => void start()}>
                {t('addFolder.start')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={pending === 'add'} onClick={() => close(false)}>
                {t('app.cancel')}
              </Button>
              {previewTimedOut && (
                <Button
                  variant="secondary"
                  loading={pending === 'add'}
                  disabled={busy || destination === null}
                  onClick={() => void start()}
                >
                  {t('addFolder.startWithoutPreview')}
                </Button>
              )}
              <Button
                type="submit"
                form={formId}
                loading={pending === 'preview'}
                disabled={busy || destination === null}
              >
                {t('addFolder.review')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
