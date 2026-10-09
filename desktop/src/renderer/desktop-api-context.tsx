import { createContext, useContext, type ReactNode } from 'react'
import type { DesktopApi } from '../shared/desktop-api'

const DesktopApiContext = createContext<DesktopApi | null>(null)

/** Returns the preload bridge, failing loudly when the window has no bridge. */
export function getDesktopBridge(): DesktopApi {
  const api = window.telerDesktop
  if (!api) throw new Error('Teler Desktop bridge is unavailable')
  return api
}

export function DesktopApiProvider({ api, children }: { api: DesktopApi; children: ReactNode }) {
  return <DesktopApiContext.Provider value={api}>{children}</DesktopApiContext.Provider>
}

export function useDesktopApi(): DesktopApi {
  const api = useContext(DesktopApiContext)
  if (!api) throw new Error('useDesktopApi must be used inside DesktopApiProvider')
  return api
}
