import { useTranslation } from 'react-i18next'
import type { NotificationSetting, NotificationSettings } from '../../shared/desktop-api'
import { useDesktopApi } from '../desktop-api-context'
import { PreferenceSwitch } from './preference-switch'
import { SectionCard } from './section-card'

/** The notification sources, in the order the page lists them. */
const SOURCES = [
  'files',
  'folders',
  'problems',
  'chats',
  'alerts',
] as const satisfies readonly NotificationSetting[]

interface NotificationsSectionProps {
  notifications: NotificationSettings
}

/** One switch per notification source, plus the sound they play. */
export function NotificationsSection({ notifications }: NotificationsSectionProps) {
  const { t } = useTranslation()
  const api = useDesktopApi()
  // The sound belongs to the notifications; with none on there is nothing to play.
  const anySource = SOURCES.some((source) => notifications[source])

  return (
    <SectionCard title={t('notifications.title')}>
      <p className="text-muted-foreground text-sm">{t('notifications.foregroundNote')}</p>
      {SOURCES.map((source) => (
        <PreferenceSwitch
          key={source}
          label={t(`notifications.${source}`)}
          hint={t(`notifications.${source}Hint`)}
          checked={notifications[source]}
          onChange={(enabled) => api.setNotificationSetting(source, enabled)}
        />
      ))}
      <PreferenceSwitch
        label={t('notifications.sound')}
        hint={t(anySource ? 'notifications.soundHint' : 'notifications.soundUnavailable')}
        checked={notifications.sound}
        disabled={!anySource}
        onChange={(enabled) => api.setNotificationSetting('sound', enabled)}
      />
    </SectionCard>
  )
}
