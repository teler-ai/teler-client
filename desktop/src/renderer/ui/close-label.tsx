import { createContext, useContext, type ReactNode } from 'react'

const CloseLabelContext = createContext('Close')

/** Names the close buttons of dialogs below it, in the page's language. */
export function CloseLabelProvider({ label, children }: { label: string; children: ReactNode }) {
  return <CloseLabelContext.Provider value={label}>{children}</CloseLabelContext.Provider>
}

export function useCloseLabel(): string {
  return useContext(CloseLabelContext)
}
