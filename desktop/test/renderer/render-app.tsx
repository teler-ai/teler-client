import { render, screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { App } from '../../src/renderer/app'
import { DesktopApiProvider } from '../../src/renderer/desktop-api-context'
import i18n from '../../src/renderer/i18n'
import type { DesktopState } from '../../src/shared/desktop-api'
import { createFakeDesktopApi, makeState, type FakeDesktopApi } from './fake-desktop-api'

export interface RenderedApp {
  api: FakeDesktopApi
  user: UserEvent
}

/** Renders the Synced folders page against a fake bridge and waits for the first state. */
export async function renderApp(state: DesktopState = makeState()): Promise<RenderedApp> {
  await i18n.changeLanguage('en')
  const api = createFakeDesktopApi(state)
  const user = userEvent.setup()
  render(
    <DesktopApiProvider api={api}>
      <App />
    </DesktopApiProvider>
  )
  // The banner appears with the first state, in whatever language it carries.
  await screen.findByTestId('status-banner')
  return { api, user }
}
