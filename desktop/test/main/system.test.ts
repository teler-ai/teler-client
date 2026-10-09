import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTranslator } from '../../src/main/i18n'
import {
  APP_ENTRY_URL,
  contentTypeFor,
  offlinePageUrl,
  resolveAppAsset,
} from '../../src/main/local-pages'
import { createLoginItems, linuxAutostartEntry } from '../../src/main/login-item'
import { preferencesFromCookies, SettingsStore } from '../../src/main/preferences'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'teler-desktop-system-'))
  directories.push(directory)
  return directory
}

describe('login items', () => {
  const comments = { en: 'Teler with folder sync', ca: 'Teler amb sincronització' }

  it('quotes the Linux autostart command and localizes its comment', () => {
    const entry = linuxAutostartEntry('/opt/My "Apps"/te$ler', comments)
    expect(entry).toContain('Exec="/opt/My \\"Apps\\"/te\\$ler" --hidden')
    expect(entry).toContain('Comment=Teler with folder sync\nComment[ca]=Teler amb sincronització')
  })

  it('writes and removes an XDG autostart entry for the AppImage', async () => {
    const home = await temporaryDirectory()
    const items = createLoginItems({
      platform: 'linux',
      app: {
        getLoginItemSettings: () => ({ openAtLogin: false }),
        setLoginItemSettings: () => undefined,
      },
      env: { APPIMAGE: '/home/ana/Teler.AppImage' },
      execPath: '/tmp/.mount_x/teler-desktop',
      homeDir: home,
      comments,
    })
    await items.setEnabled(true)
    expect(await items.isEnabled()).toBe(true)
    const entry = await readFile(
      join(home, '.config', 'autostart', 'ai.teler.desktop.desktop'),
      'utf8'
    )
    expect(entry).toContain('Exec="/home/ana/Teler.AppImage" --hidden')
    await items.setEnabled(false)
    expect(await items.isEnabled()).toBe(false)
  })

  it('uses system login items with the hidden flag elsewhere', async () => {
    // Like Windows: an entry only reads as enabled when queried with its own arguments.
    let registered: { openAtLogin: boolean; args?: string[] } = { openAtLogin: false }
    const items = createLoginItems({
      platform: 'win32',
      app: {
        getLoginItemSettings: (options) => ({
          openAtLogin:
            registered.openAtLogin &&
            JSON.stringify(options?.args ?? []) === JSON.stringify(registered.args ?? []),
        }),
        setLoginItemSettings: (settings) => void (registered = settings),
      },
      env: {},
      execPath: 'C:\\Teler.exe',
      homeDir: 'C:\\Users\\ana',
      comments,
    })
    await items.setEnabled(true)
    expect(registered).toEqual({ openAtLogin: true, args: ['--hidden'] })
    expect(await items.isEnabled()).toBe(true)
    await items.setEnabled(false)
    expect(await items.isEnabled()).toBe(false)
  })
})

describe('preferences', () => {
  it('follows the Teler language and theme cookies', () => {
    expect(
      preferencesFromCookies(
        [
          { name: 'i18next', value: 'ca' },
          { name: 'theme-variant', value: 'dali' },
          { name: 'theme', value: 'dark' },
        ],
        'en-US',
        'light'
      )
    ).toEqual({ language: 'ca', themeVariant: 'dali', colorMode: 'dark' })
  })

  it('falls back to the system for missing or invalid values', () => {
    expect(
      preferencesFromCookies([{ name: 'theme-variant', value: '<script>' }], 'pt-BR', 'dark')
    ).toEqual({ language: 'pt', themeVariant: 'default', colorMode: 'dark' })
  })

  it('persists desktop settings', async () => {
    const file = join(await temporaryDirectory(), 'settings.json')
    const store = new SettingsStore(file)
    expect(await store.load()).toEqual({
      syncPaused: false,
      openAtLoginInitialized: false,
      autoConnect: false,
      folderProjects: {},
      notifications: {
        files: true,
        folders: true,
        problems: true,
        chats: true,
        alerts: true,
        sound: true,
      },
    })
    await store.update({ syncPaused: true, autoConnect: true })
    expect(await new SettingsStore(file).load()).toEqual({
      syncPaused: true,
      openAtLoginInitialized: false,
      autoConnect: true,
      folderProjects: {},
      notifications: {
        files: true,
        folders: true,
        problems: true,
        chats: true,
        alerts: true,
        sound: true,
      },
    })
  })

  it('keeps settings saved before sync followed sign-ins', async () => {
    const file = join(await temporaryDirectory(), 'settings.json')
    await writeFile(
      file,
      JSON.stringify({ version: 1, syncPaused: true, openAtLoginInitialized: true })
    )
    expect(await new SettingsStore(file).load()).toEqual({
      syncPaused: true,
      openAtLoginInitialized: true,
      autoConnect: false,
      folderProjects: {},
      notifications: {
        files: true,
        folders: true,
        problems: true,
        chats: true,
        alerts: true,
        sound: true,
      },
    })
  })
})

describe('local pages', () => {
  const root = '/app/dist/renderer'

  it('serves only files inside the renderer bundle', () => {
    expect(resolveAppAsset(root, APP_ENTRY_URL)).toBe(join(root, 'index.html'))
    expect(resolveAppAsset(root, 'teler-desktop://app/')).toBe(join(root, 'index.html'))
    expect(resolveAppAsset(root, 'teler-desktop://app/assets/main.js')).toBe(
      join(root, 'assets', 'main.js')
    )
    // Dot segments are clamped to the bundle root, never resolved above it.
    for (const url of [
      'teler-desktop://app/../../secret',
      'teler-desktop://app/%2e%2e/%2e%2e/secret',
      'teler-desktop://app/..%2f..%2fsecret',
    ])
      expect(resolveAppAsset(root, url), url).toBe(join(root, 'secret'))
    for (const url of [
      'teler-desktop://app/..\\..\\secret',
      'teler-desktop://app/..%5c..%5csecret',
      'teler-desktop://other/index.html',
      'https://app/index.html',
      'teler-desktop://app/%00',
      'teler-desktop://app/%E0%A4%A',
    ])
      expect(resolveAppAsset(root, url), url).toBeNull()
  })

  it('labels content types', () => {
    expect(contentTypeFor('a/index.html')).toBe('text/html; charset=utf-8')
    expect(contentTypeFor('a/font.woff2')).toBe('font/woff2')
    expect(contentTypeFor('a/blob.bin')).toBe('application/octet-stream')
  })

  it('escapes the offline page and links back to Teler', () => {
    const url = offlinePageUrl('https://app.teler.ai', createTranslator('en'))
    const html = decodeURIComponent(url.slice(url.indexOf(',') + 1))
    expect(html).toContain('href="https://app.teler.ai/"')
    expect(html).toContain('Teler can&#39;t be reached')
    expect(html).not.toContain('<script')
  })

  it('turns Agent alerts on for settings saved before they existed', async () => {
    const file = join(await temporaryDirectory(), 'settings.json')
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        syncPaused: false,
        openAtLoginInitialized: true,
        notifications: { files: false, folders: true, problems: true, chats: false, sound: true },
      })
    )
    expect((await new SettingsStore(file).load()).notifications).toEqual({
      files: false,
      folders: true,
      problems: true,
      chats: false,
      alerts: true,
      sound: true,
    })
  })
})
