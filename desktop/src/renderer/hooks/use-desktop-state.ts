import { useCallback, useEffect, useState } from 'react'
import type { DesktopApi, DesktopState } from '../../shared/desktop-api'

export type DesktopStateLoad =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; state: DesktopState }

/**
 * Loads the snapshot and follows pushed updates. A pushed state is always at
 * least as new as the initial snapshot, so a late `getState` never wins.
 */
export function useDesktopState(api: DesktopApi): {
  load: DesktopStateLoad
  retry: () => void
} {
  const [load, setLoad] = useState<DesktopStateLoad>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const unsubscribe = api.onStateChanged((state) => {
      if (active) setLoad({ status: 'ready', state })
    })
    api.getState().then(
      (state) => {
        if (active)
          setLoad((current) => (current.status === 'ready' ? current : { status: 'ready', state }))
      },
      () => {
        if (active)
          setLoad((current) => (current.status === 'ready' ? current : { status: 'error' }))
      }
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [api, attempt])

  const retry = useCallback(() => {
    setLoad({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  return { load, retry }
}
