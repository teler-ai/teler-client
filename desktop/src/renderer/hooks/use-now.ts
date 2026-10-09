import { useEffect, useState } from 'react'

const TICK_MS = 1000

/**
 * The current time, refreshed every second until `until` has passed, so a
 * countdown such as "in 3 minutes" stays truthful and a notice that ends at
 * `until` disappears on time. Idle when `until` is null.
 */
export function useNow(until: number | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (until === null) return
    // Both timers run `tick` only after they exist, so it can stop the interval.
    const tick = () => {
      const current = Date.now()
      setNow(current)
      if (current >= until) clearInterval(timer)
    }
    const timer = setInterval(tick, TICK_MS)
    // Refresh at once: the clock may be stale after a long idle stretch.
    const first = setTimeout(tick, 0)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [until])

  return now
}
