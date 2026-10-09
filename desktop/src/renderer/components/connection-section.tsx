import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { CircleAlert, KeyRound, LogIn } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopErrorCode, DesktopState } from '../../shared/desktop-api'
import { useDesktopApi } from '../desktop-api-context'
import { ConfirmDialog } from './confirm-dialog'
import { SectionCard } from './section-card'

interface ConnectionSectionProps {
  state: DesktopState
}

export function ConnectionSection({ state }: ConnectionSectionProps) {
  const { t } = useTranslation()
  const api = useDesktopApi()
  const { connection } = state
  const [connecting, setConnecting] = useState(false)
  const [localError, setLocalError] = useState<DesktopErrorCode | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [errorStatus, setErrorStatus] = useState(connection.status)
  // A local failure belongs to the attempt that produced it. A new attempt
  // (including the automatic one after signing in) or a connection clears it;
  // the attempt ending as `disconnected` keeps it visible.
  if (errorStatus !== connection.status) {
    setErrorStatus(connection.status)
    if (connection.status !== 'disconnected') setLocalError(null)
  }
  const error = localError ?? connection.error

  const connect = async () => {
    setConnecting(true)
    setLocalError(null)
    try {
      const result = await api.connect()
      if (!result.ok) setLocalError(result.error)
    } catch {
      setLocalError('connect-failed')
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    setLocalError(null)
    try {
      await api.disconnect()
    } catch {
      setLocalError('sync-failed')
    }
  }

  const name = connection.account?.name

  return (
    <SectionCard title={t('connection.title')}>
      {connection.status === 'disconnected' && (
        <div className="flex flex-col items-start gap-4">
          <p className="text-muted-foreground text-sm">{t('connection.intro')}</p>
          <Button loading={connecting} disabled={connecting} onClick={() => void connect()}>
            {t('connection.connect')}
          </Button>
        </div>
      )}

      {connection.status === 'connecting' && (
        <div role="status" className="text-foreground flex items-center gap-2 text-sm">
          <Spinner className="text-primary" />
          <span>{t('connection.connecting')}</span>
        </div>
      )}

      {connection.status === 'connected' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-foreground text-sm">
            {name ? t('connection.connectedAs', { name }) : t('connection.connected')}
          </p>
          <Button variant="secondary" onClick={() => setConfirmDisconnect(true)}>
            {t('connection.disconnect')}
          </Button>
        </div>
      )}

      {error === 'signed-out' ? (
        // Not a failure: the user signs in to the Teler window and sync follows.
        <Alert variant="warning">
          <LogIn aria-hidden="true" className="size-4" />
          <AlertDescription>{t('errors.signed-out')}</AlertDescription>
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void api.openTeler().catch(() => undefined)}
            >
              {t('connection.signIn')}
            </Button>
          </div>
        </Alert>
      ) : (
        error && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" className="size-4" />
            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
          </Alert>
        )
      )}

      {state.credentialPersistence === 'session' && (
        <Alert variant="warning" role="note">
          <KeyRound aria-hidden="true" className="size-4" />
          <AlertTitle>{t('connection.sessionOnlyTitle')}</AlertTitle>
          <AlertDescription>{t('connection.sessionOnlyBody')}</AlertDescription>
        </Alert>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t('connection.disconnectTitle')}
        description={t('connection.disconnectBody')}
        confirmLabel={t('connection.disconnect')}
        onConfirm={disconnect}
      />
    </SectionCard>
  )
}
