import { ArrowLeft, ArrowRight, Menu, RotateCw } from 'lucide-react'
import { useEffect, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TitleBarApi, TitleBarState } from '../../shared/title-bar-api'
import logoMarkUrl from '../assets/teler-logo-mark.svg'
import { applyPreferences } from '../lib/apply-preferences'
import { Button } from '../ui/button'
import { SyncStatusButton } from './sync-status-button'
import { useTitleBarState } from './use-title-bar-state'

/** Fires a bridge call; failures surface through the pushed state, not here. */
function run(action: () => Promise<void>): void {
  action().catch(() => undefined)
}

/** The Teler mark; decorative, since the window title names the app. */
function LogoMark() {
  return <img src={logoMarkUrl} alt="" draggable={false} className="size-4.5" />
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="app-region-no-drag"
    >
      {children}
    </Button>
  )
}

function Controls({ api, state }: { api: TitleBarApi; state: TitleBarState }) {
  const { t } = useTranslation()
  // Navigation acts on the Teler page, which is hidden behind Synced folders.
  const syncView = state.view === 'sync'

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    // The menu opens under the button, aligned with its left edge.
    const { left, bottom } = event.currentTarget.getBoundingClientRect()
    run(() => api.openMenu(Math.round(left), Math.round(bottom)))
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1">
        {state.showMenuButton && (
          <NavButton label={t('titleBar.menu')} onClick={openMenu}>
            <Menu aria-hidden="true" />
          </NavButton>
        )}
        <span aria-hidden="true" className="flex items-center px-1.5">
          <LogoMark />
        </span>
        <div role="group" aria-label={t('titleBar.navigation')} className="flex items-center gap-1">
          <NavButton
            label={t('titleBar.back')}
            disabled={syncView || !state.canGoBack}
            onClick={() => run(() => api.back())}
          >
            <ArrowLeft aria-hidden="true" />
          </NavButton>
          <NavButton
            label={t('titleBar.forward')}
            disabled={syncView || !state.canGoForward}
            onClick={() => run(() => api.forward())}
          >
            <ArrowRight aria-hidden="true" />
          </NavButton>
          <NavButton
            label={t('titleBar.reload')}
            disabled={syncView}
            onClick={() => run(() => api.reload())}
          >
            <RotateCw aria-hidden="true" />
          </NavButton>
        </div>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <SyncStatusButton
          health={state.health}
          pendingFiles={state.pendingFiles}
          pressed={syncView}
          onToggle={() => run(() => api.openSettings())}
        />
      </div>

      {state.loading && (
        // Static under reduced motion, so loading stays visible without movement.
        <span
          aria-hidden="true"
          data-testid="title-bar-loading"
          className="bg-primary pointer-events-none absolute inset-x-0 -bottom-px h-0.5 motion-safe:animate-pulse"
        />
      )}
    </>
  )
}

/**
 * The app top bar drawn above the remote Teler page in the main window. The
 * whole bar moves the window; every control opts out of the drag region.
 */
export function TitleBar({ api }: { api: TitleBarApi }) {
  const { i18n } = useTranslation()
  const state = useTitleBarState(api)
  const preferences = state?.preferences ?? null

  useEffect(() => {
    if (!preferences) return
    applyPreferences(preferences)
    if (i18n.language !== preferences.language) void i18n.changeLanguage(preferences.language)
  }, [preferences, i18n])

  return (
    <header
      data-testid="title-bar"
      onContextMenu={(event) => event.preventDefault()}
      style={{ paddingLeft: state?.insets.left ?? 0, paddingRight: state?.insets.right ?? 0 }}
      className="app-region-drag bg-background text-foreground border-border relative flex h-full w-full cursor-default border-b select-none"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
        {state ? (
          <Controls api={api} state={state} />
        ) : (
          <span aria-hidden="true" className="flex items-center px-1.5">
            <LogoMark />
          </span>
        )}
      </div>
    </header>
  )
}
