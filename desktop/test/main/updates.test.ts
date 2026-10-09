import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DOWNLOAD_PREFIX } from '@teler-ai/cli/releases'
import { buildApplicationMenu, type MenuActions } from '../../src/main/app-menu'
import { createTranslator } from '../../src/main/i18n'
import {
  DesktopUpdates,
  type DesktopUpdatesDeps,
  type UpdateMessage,
} from '../../src/main/updates/desktop-updates'
import { findUpdate, installerUrl, type Installation } from '../../src/main/updates/find-update'

const t = createTranslator('en')
const INSTALLERS = [
  'Teler-0.3.0-mac-arm64.dmg',
  'Teler-0.3.0-mac-arm64.zip',
  'Teler-0.3.0-mac-x64.dmg',
  'Teler-0.3.0-win-x64.exe',
  'Teler-0.3.0-linux-x86_64.AppImage',
  'Teler-0.3.0-linux-amd64.deb',
]

function listing(tag = 'desktop-v0.3.0', names = INSTALLERS) {
  return [
    {
      tag_name: tag,
      html_url: `https://github.com/teler-ai/teler-client/releases/tag/${tag}`,
      draft: false,
      prerelease: false,
      assets: names.map((name) => ({
        name,
        browser_download_url: `${DOWNLOAD_PREFIX}${tag}/${name}`,
        size: 1,
      })),
    },
    {
      tag_name: 'cli-v9.0.0',
      html_url: 'https://github.com/x',
      draft: false,
      prerelease: false,
      assets: [],
    },
  ]
}
const serve = (body: unknown) =>
  vi.fn<(input: string) => Promise<Response>>(async () => Response.json(body))
const url = (name: string) => `${DOWNLOAD_PREFIX}desktop-v0.3.0/${name}`
const machine = (overrides: Partial<Installation> = {}): Installation => ({
  platform: 'darwin',
  arch: 'arm64',
  appImage: false,
  ...overrides,
})

describe('the installer for this machine', () => {
  const release = {
    version: '0.3.0',
    pageUrl: 'https://github.com/teler-ai/teler-client/releases/tag/desktop-v0.3.0',
    assets: INSTALLERS.map((name) => ({ name, url: url(name), size: 1 })),
  }

  it('matches the platform, architecture and package type', () => {
    expect(installerUrl(release, machine())).toBe(url('Teler-0.3.0-mac-arm64.dmg'))
    expect(installerUrl(release, machine({ arch: 'x64' }))).toBe(url('Teler-0.3.0-mac-x64.dmg'))
    expect(installerUrl(release, machine({ platform: 'win32', arch: 'x64' }))).toBe(
      url('Teler-0.3.0-win-x64.exe')
    )
    const linux = machine({ platform: 'linux', arch: 'x64' })
    expect(installerUrl(release, linux)).toBe(url('Teler-0.3.0-linux-amd64.deb'))
    expect(installerUrl(release, { ...linux, appImage: true })).toBe(
      url('Teler-0.3.0-linux-x86_64.AppImage')
    )
    expect(installerUrl(release, machine({ platform: 'linux', arch: 'arm64' }))).toBeNull()
  })

  it('offers a newer release, falling back to its page without an installer', async () => {
    expect(await findUpdate('0.2.0', machine(), serve(listing()))).toEqual({
      version: '0.3.0',
      downloadUrl: url('Teler-0.3.0-mac-arm64.dmg'),
    })
    expect(await findUpdate('0.3.0', machine(), serve(listing()))).toBeNull()
    expect(await findUpdate('0.2.0', machine(), serve(listing('desktop-v0.3.0', [])))).toEqual({
      version: '0.3.0',
      downloadUrl: 'https://github.com/teler-ai/teler-client/releases/tag/desktop-v0.3.0',
    })
  })
})

describe('desktop updates', () => {
  let messages: UpdateMessage[]
  let deps: DesktopUpdatesDeps & {
    fetch: Mock<(input: string) => Promise<Response>>
    notify: Mock<(title: string, body: string, onClick: () => void) => void>
    openExternal: Mock<(url: string) => void>
    onChange: Mock<() => void>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    messages = []
    deps = {
      currentVersion: '0.2.0',
      installation: machine(),
      automatic: true,
      fetch: serve(listing()),
      translate: () => t,
      onChange: vi.fn<() => void>(),
      notify: vi.fn<(title: string, body: string, onClick: () => void) => void>(),
      ask: async (message) => {
        messages.push(message)
        return 0
      },
      openExternal: vi.fn<(url: string) => void>(),
    }
  })
  afterEach(() => vi.useRealTimers())

  it('checks after startup and twice a day, announcing a version once', async () => {
    const updates = new DesktopUpdates(deps)
    updates.start()
    await vi.advanceTimersByTimeAsync(29_000)
    expect(deps.fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(updates.available?.version).toBe('0.3.0')
    expect(deps.onChange).toHaveBeenCalledTimes(1)
    expect(deps.notify).toHaveBeenCalledTimes(1)
    expect(deps.notify.mock.calls[0]?.slice(0, 2)).toEqual([
      'Teler 0.3.0 is available',
      'Click to download the update.',
    ])
    await vi.advanceTimersByTimeAsync(12 * 60 * 60_000)
    expect(deps.fetch).toHaveBeenCalledTimes(2)
    expect(deps.notify).toHaveBeenCalledTimes(1)
    deps.notify.mock.calls[0]?.[2]()
    await vi.waitFor(() =>
      expect(deps.openExternal).toHaveBeenCalledWith(url('Teler-0.3.0-mac-arm64.dmg'))
    )
    updates.stop()
  })

  it('does not check on its own in development builds', async () => {
    new DesktopUpdates({ ...deps, automatic: false }).start()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('answers "Check for Updates…" with the download, without a notification', async () => {
    await new DesktopUpdates(deps).checkNow()
    expect(messages).toEqual([
      {
        kind: 'info',
        title: 'Teler 0.3.0 is available',
        detail:
          'You have Teler 0.2.0. Download the new version and install it over this one; your synced folders stay as they are.',
        buttons: ['Download', 'Later'],
      },
    ])
    expect(deps.openExternal).toHaveBeenCalledWith(url('Teler-0.3.0-mac-arm64.dmg'))
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('says when it is up to date or cannot check', async () => {
    await new DesktopUpdates({ ...deps, currentVersion: '0.3.0' }).checkNow()
    const failing = vi.fn(async () => new Response('Not Found', { status: 404 }))
    await new DesktopUpdates({ ...deps, fetch: failing }).checkNow()
    expect(messages.map((message) => [message.kind, message.title])).toEqual([
      ['info', 'Teler is up to date'],
      ['error', "Couldn't check for updates"],
    ])
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('shows one dialog at a time', async () => {
    let answer: (choice: number) => void = () => undefined
    const ask = vi.fn(() => new Promise<number>((resolve) => (answer = resolve)))
    const updates = new DesktopUpdates({ ...deps, ask })
    const first = updates.checkNow()
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    await updates.checkNow()
    await updates.install()
    expect(ask).toHaveBeenCalledTimes(1)
    answer(1)
    await first
  })

  it('answers a manual check that joins an automatic one with a dialog only', async () => {
    let respond: (response: Response) => void = () => undefined
    const fetch = vi.fn<(input: string) => Promise<Response>>(
      () => new Promise((resolve) => (respond = resolve))
    )
    const updates = new DesktopUpdates({ ...deps, fetch })
    updates.start()
    await vi.advanceTimersByTimeAsync(30_000)
    const manual = updates.checkNow()
    respond(Response.json(listing()))
    await manual
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(messages.map((message) => message.title)).toEqual(['Teler 0.3.0 is available'])
    expect(deps.notify).not.toHaveBeenCalled()
    updates.stop()
  })

  it('downloads only when the user chooses to', async () => {
    const updates = new DesktopUpdates({ ...deps, ask: async () => 1 })
    updates.start()
    await vi.advanceTimersByTimeAsync(30_000)
    await updates.install()
    expect(deps.openExternal).not.toHaveBeenCalled()
    updates.stop()
  })
})

describe('application menu', () => {
  const actions: MenuActions = {
    openSettings: vi.fn(),
    signInWithCopiedLink: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    openWebsite: vi.fn(),
    checkForUpdates: vi.fn(),
  }
  const labelsOf = (menu: ReturnType<typeof buildApplicationMenu>, index: number) => {
    const submenu = menu[index]?.submenu
    return Array.isArray(submenu) ? submenu.map((item) => item.label ?? item.role ?? item.type) : []
  }

  it('checks for updates from the app menu on macOS and the Help menu elsewhere', () => {
    const mac = buildApplicationMenu('darwin', t, actions)
    expect(labelsOf(mac, 0).slice(0, 2)).toEqual(['About Teler', 'Check for Updates…'])
    expect(labelsOf(mac, mac.length - 1)).toEqual(['Visit teler.ai'])
    const windows = buildApplicationMenu('win32', t, actions)
    expect(labelsOf(windows, windows.length - 1)).toEqual([
      'Visit teler.ai',
      'Check for Updates…',
      'separator',
      'About Teler',
    ])
  })
})
