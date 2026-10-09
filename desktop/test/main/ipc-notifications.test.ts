import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcDeps } from '../../src/main/ipc'
import { DESKTOP_CHANNELS } from '../../src/shared/desktop-api'

type Handler = (event: unknown, ...payload: unknown[]) => unknown
const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))

const { registerIpc } = await import('../../src/main/ipc')

const stubContents: Partial<Electron.WebContents> = {}
const contents = stubContents as Electron.WebContents
const trustedEvent = {
  sender: contents,
  senderFrame: { url: 'teler-desktop://app/index.html' },
}

describe('notification settings over IPC', () => {
  const setNotificationSetting = vi.fn(async () => undefined)

  beforeEach(() => {
    handlers.clear()
    setNotificationSetting.mockClear()
    const deps: Partial<IpcDeps> = { settingsContents: () => contents, setNotificationSetting }
    registerIpc(deps as IpcDeps)
  })

  const call = (event: unknown, ...payload: unknown[]) =>
    handlers.get(DESKTOP_CHANNELS.setNotificationSetting)?.(event, ...payload)

  it('accepts the Agent alerts switch from the Synced folders page', async () => {
    await call(trustedEvent, 'alerts', false)
    expect(setNotificationSetting).toHaveBeenCalledWith('alerts', false)
  })

  it('refuses an unknown switch and an untrusted sender', () => {
    expect(() => call(trustedEvent, 'repeats', true)).toThrow()
    expect(() =>
      call({ sender: {}, senderFrame: trustedEvent.senderFrame }, 'alerts', true)
    ).toThrow('Untrusted sender')
    expect(setNotificationSetting).not.toHaveBeenCalled()
  })
})
