import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopState } from '../shared/desktop-api'
import { ConnectionSection } from './components/connection-section'
import { FoldersSection } from './components/folders-section'
import { NotificationsSection } from './components/notifications-section'
import { PreferencesSection } from './components/preferences-section'
import { StatusBanner } from './components/status-banner'
import { ThrottleNotice } from './components/throttle-notice'
import { useDesktopApi } from './desktop-api-context'
import { useDesktopState } from './hooks/use-desktop-state'
import { applyPreferences } from './lib/apply-preferences'
import { totalPending, totalWaiting } from './lib/format'
import { Button } from './ui/button'
import { CloseLabelProvider } from './ui/close-label'
import { Spinner } from './ui/spinner'

/** Layers that handle Escape themselves: dialogs, menus and listboxes. */
const ESCAPE_OWNERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/** Escape returns to the Teler page unless an open dialog or menu takes it. */
function useEscapeToTeler(openTeler: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return
      if (document.querySelector(ESCAPE_OWNERS)) return
      openTeler()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openTeler])
}

function SyncedFoldersPage({ state }: { state: DesktopState }) {
  const { t } = useTranslation()
  const { connection } = state
  const name = connection.account?.name
  const accountLine =
    connection.status !== 'connected'
      ? t('account.notConnected')
      : name
        ? t('account.syncingAs', { name })
        : t('account.connected')

  return (
    <>
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-foreground font-display text-2xl font-semibold">{t('page.title')}</h1>
        <p className="text-muted-foreground truncate text-sm">{accountLine}</p>
      </header>

      <StatusBanner
        health={state.health}
        pendingFiles={totalPending(state.folders)}
        waitingFiles={totalWaiting(state.folders)}
      />
      <ThrottleNotice until={state.throttledUntil} />
      <ConnectionSection state={state} />
      <FoldersSection
        folders={state.folders}
        connected={connection.status === 'connected'}
        folderRequest={state.folderRequest}
        organizations={state.organizations}
        activeOrganizationId={state.activeOrganizationId}
        throttledUntil={state.throttledUntil}
        syncPaused={state.syncPaused}
      />
      <PreferencesSection
        openAtLogin={state.openAtLogin}
        openAtLoginAvailable={state.openAtLoginAvailable}
        syncPaused={state.syncPaused}
      />
      <NotificationsSection notifications={state.notifications} />
    </>
  )
}

/**
 * The Synced folders page, shown in the main window below the top bar in
 * place of the Teler page.
 */
export function App() {
  const { t, i18n } = useTranslation()
  const api = useDesktopApi()
  const { load, retry } = useDesktopState(api)
  const preferences = load.status === 'ready' ? load.state.preferences : null
  const backToTeler = useCallback(() => void api.openTeler().catch(() => undefined), [api])

  useEscapeToTeler(backToTeler)

  useEffect(() => {
    if (!preferences) return
    applyPreferences(preferences)
    if (i18n.language !== preferences.language) void i18n.changeLanguage(preferences.language)
  }, [preferences, i18n])

  return (
    <CloseLabelProvider label={t('app.close')}>
      <div className="bg-background text-foreground min-h-dvh">
        <main className="mx-auto flex max-w-2xl flex-col gap-5 px-6 pt-4 pb-10">
          <div>
            <Button variant="ghost" size="sm" className="-ml-2" onClick={backToTeler}>
              <ArrowLeft aria-hidden="true" />
              {t('page.back')}
            </Button>
          </div>
          {load.status === 'ready' && <SyncedFoldersPage state={load.state} />}
          {load.status === 'loading' && (
            <div className="flex min-h-[60dvh] items-center justify-center">
              <Spinner size="lg" label={t('app.loading')} className="text-primary" />
            </div>
          )}
          {load.status === 'error' && (
            <div
              role="alert"
              className="flex min-h-[60dvh] flex-col items-center justify-center gap-3"
            >
              <p className="text-foreground">{t('app.loadError')}</p>
              <Button variant="outline" onClick={retry}>
                {t('app.retry')}
              </Button>
            </div>
          )}
        </main>
      </div>
    </CloseLabelProvider>
  )
}
