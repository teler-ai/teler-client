import { Alert, AlertDescription } from '../ui/alert'
import { Hourglass } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNow } from '../hooks/use-now'
import { formatClock } from '../lib/format'

/**
 * Teler limits how fast an account starts uploads. While it does, retrying
 * cannot help, so the page says when uploads resume; the notice disappears then.
 */
export function ThrottleNotice({ until }: { until: number | null }) {
  const { t, i18n } = useTranslation()
  const now = useNow(until)
  if (until === null || until <= now) return null

  return (
    <Alert role="status" data-testid="throttle-notice">
      <Hourglass aria-hidden="true" className="size-4" />
      <AlertDescription>
        {t('throttle.notice', { time: formatClock(until, i18n.language) })}
      </AlertDescription>
    </Alert>
  )
}
