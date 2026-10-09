import { useEffect, useState } from 'react'
import type { TitleBarApi, TitleBarState } from '../../shared/title-bar-api'

/**
 * Loads the bar's snapshot and follows pushed updates. A pushed state is
 * always at least as new as the snapshot, so a late `getState` never wins.
 * Until a state arrives (or if the snapshot fails) the bar stays empty but
 * still moves the window; the next pushed state fills it in.
 */
export function useTitleBarState(api: TitleBarApi): TitleBarState | null {
  const [state, setState] = useState<TitleBarState | null>(null)

  useEffect(() => {
    let active = true
    const unsubscribe = api.onStateChanged((next) => {
      if (active) setState(next)
    })
    api.getState().then(
      (snapshot) => {
        if (active) setState((current) => current ?? snapshot)
      },
      () => {
        // Nothing to show yet; pushed states recover the bar.
      }
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  return state
}
