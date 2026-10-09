import { useTranslation } from 'react-i18next'
import { useDesktopApi } from '../desktop-api-context'
import { PreferenceSwitch } from './preference-switch'
import { SectionCard } from './section-card'

interface PreferencesSectionProps {
  openAtLogin: boolean
  openAtLoginAvailable: boolean
  syncPaused: boolean
}

export function PreferencesSection({
  openAtLogin,
  openAtLoginAvailable,
  syncPaused,
}: PreferencesSectionProps) {
  const { t } = useTranslation()
  const api = useDesktopApi()

  return (
    <SectionCard title={t('preferences.title')}>
      <PreferenceSwitch
        label={t('preferences.openAtLogin')}
        hint={t(
          openAtLoginAvailable
            ? 'preferences.openAtLoginHint'
            : 'preferences.openAtLoginUnavailable'
        )}
        checked={openAtLogin}
        disabled={!openAtLoginAvailable}
        onChange={(enabled) => api.setOpenAtLogin(enabled)}
      />
      <PreferenceSwitch
        label={t('preferences.pauseSync')}
        hint={t('preferences.pauseSyncHint')}
        checked={syncPaused}
        onChange={(paused) => api.setSyncPaused(paused)}
      />
    </SectionCard>
  )
}
