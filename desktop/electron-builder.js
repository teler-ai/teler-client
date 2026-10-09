// @ts-check
import { readdirSync, readFileSync } from 'node:fs'
import { URL } from 'node:url'

/**
 * OS-facing copy comes from the main-process catalogs, one per language.
 *
 * @returns {Array<[string, Record<string, string>]>}
 */
function catalogs() {
  const directory = new URL('./src/main/locales/', import.meta.url)
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => [
      file.slice(0, -'.json'.length),
      JSON.parse(readFileSync(new URL(file, directory), 'utf8')),
    ])
}

/**
 * Chromium locales to keep, generated per supported language by scripts/build.ts.
 *
 * @returns {string[]}
 */
function electronLanguages() {
  const file = new URL('./.packaging/electron-languages.json', import.meta.url)
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error('Run `bun run --filter desktop build` before packaging Teler Desktop')
  }
}

const copy = Object.fromEntries(catalogs())
const english = copy.en ?? {}
const localizedComments = Object.fromEntries(
  Object.entries(copy)
    .filter(([language]) => language !== 'en')
    .map(([language, catalog]) => [`Comment[${language}]`, catalog['system.appDescription']])
)

/**
 * Packaging for Teler Desktop. Builds are unsigned unless the release workflow
 * supplies signing credentials; see README.md.
 *
 * @type {import('electron-builder').Configuration}
 */
export default {
  appId: 'ai.teler.desktop',
  productName: 'Teler',
  copyright: 'Copyright © teler.ai',
  artifactName: 'Teler-${version}-${os}-${arch}.${ext}',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  // scripts/build.ts bundles everything the app runs into dist/, so no
  // node_modules ship. Returning false marks dependencies as handled outside
  // electron-builder; otherwise it falls back to the workspace root and packs
  // the other workspaces' dependencies.
  beforeBuild: async () => false,
  files: ['dist/**/*', 'package.json', '!dist/**/*.map', '!**/node_modules/**/*'],
  nodeGypRebuild: false,
  asar: true,
  // The `teler` CLI compiled by scripts/sidecar.ts for the target platform.
  // The app icon as a plain file too: GTK (the Linux About dialog) cannot read
  // inside the asar archive.
  extraResources: [
    { from: '.sidecar/${os}-${arch}', to: 'sidecar' },
    { from: 'build/icon.png', to: 'icon.png' },
  ],
  // Chromium UI strings for the supported languages (see system-strings.ts).
  electronLanguages: electronLanguages(),
  mac: {
    category: 'public.app-category.productivity',
    target: ['dmg', 'zip'],
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // `bun build --compile` already signs the sync sidecar, in a layout codesign cannot re-sign.
    signIgnore: ['/Contents/Resources/sidecar/'],
    extendInfo: {
      NSMicrophoneUsageDescription: english['system.microphoneUsage'],
    },
    // Localized microphone prompts written by scripts/build.ts.
    extraResources: [{ from: '.packaging/mac', to: '.' }],
  },
  win: {
    target: ['nsis'],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Office',
    executableName: 'teler-desktop',
    syncDesktopName: true,
    synopsis: english['system.appDescription'],
    maintainer: 'teler.ai <legal@teler.ai>',
    desktop: {
      entry: { Comment: english['system.appDescription'], ...localizedComments },
    },
  },
  publish: null,
}
