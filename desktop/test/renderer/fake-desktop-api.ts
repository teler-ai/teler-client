import { vi, type Mock } from 'vitest'
import type {
  DesktopApi,
  DesktopState,
  FolderPreview,
  ProblemFile,
  SyncedFolder,
} from '../../src/shared/desktop-api'

/** Every bridge method as a typed Vitest mock. */
export type FakeDesktopApi = { [K in keyof DesktopApi]: Mock<DesktopApi[K]> } & {
  /** Pushes a state update to every `onStateChanged` listener. */
  emit: (state: DesktopState) => void
}

export function makeFolder(overrides: Partial<SyncedFolder> = {}): SyncedFolder {
  return {
    id: 'folder-1',
    localPath: '/Users/ana/Documents/Reports',
    name: 'Reports',
    destination: '/personal/Reports',
    status: 'ready',
    counts: { synced: 12, pending: 0, waiting: 0, problems: 0, skipped: 0 },
    problemFiles: [],
    waitingFiles: [],
    nextRetryAt: null,
    organizationId: 'org-1',
    projectId: null,
    projectName: null,
    checkedAt: 1_760_000_000_000,
    ...overrides,
  }
}

export function makeState(overrides: Partial<DesktopState> = {}): DesktopState {
  return {
    origin: 'https://app.teler.test',
    platform: 'darwin',
    connection: {
      status: 'connected',
      account: { id: 'user-1', name: 'Ana Puig' },
      error: null,
    },
    health: 'up-to-date',
    syncPaused: false,
    openAtLogin: false,
    openAtLoginAvailable: true,
    credentialPersistence: 'encrypted',
    folders: [],
    preferences: { language: 'en', themeVariant: 'default', colorMode: 'light' },
    folderRequest: null,
    throttledUntil: null,
    organizations: [{ id: 'org-1', name: 'Acme' }],
    activeOrganizationId: 'org-1',
    notifications: {
      files: true,
      folders: true,
      problems: true,
      chats: true,
      alerts: true,
      sound: true,
    },
    ...overrides,
  }
}

export const disconnected: DesktopState['connection'] = {
  status: 'disconnected',
  account: null,
  error: null,
}

/** A file retrying on its own after a temporary failure. */
export function makeWaitingFile(overrides: Partial<ProblemFile> = {}): ProblemFile {
  return {
    relativePath: 'q3/forecast.xlsx',
    status: 'retrying',
    retryAt: null,
    reason: 'RATE_LIMITED',
    ...overrides,
  }
}

export function makePreview(overrides: Partial<FolderPreview> = {}): FolderPreview {
  return {
    localPath: '/Users/ana/Projects/Q3 Sales',
    destination: '/personal/Q3 Sales',
    fileCount: 42,
    totalBytes: 3_400_000,
    sampleFiles: ['summary.xlsx', 'regions/emea.csv'],
    skipped: { excluded: 3, unsupported: 1, other: 0 },
    ...overrides,
  }
}

export function createFakeDesktopApi(initial: DesktopState = makeState()): FakeDesktopApi {
  const listeners = new Set<(state: DesktopState) => void>()
  return {
    emit: (state) => listeners.forEach((listener) => listener(state)),
    getState: vi.fn<DesktopApi['getState']>(async () => initial),
    onStateChanged: vi.fn<DesktopApi['onStateChanged']>((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    connect: vi.fn<DesktopApi['connect']>(async () => ({ ok: true, value: null })),
    disconnect: vi.fn<DesktopApi['disconnect']>(async () => undefined),
    chooseFolder: vi.fn<DesktopApi['chooseFolder']>(async () => null),
    previewFolder: vi.fn<DesktopApi['previewFolder']>(async () => ({
      ok: true,
      value: makePreview(),
    })),
    addFolder: vi.fn<DesktopApi['addFolder']>(async () => ({ ok: true, value: makeFolder() })),
    pauseFolder: vi.fn<DesktopApi['pauseFolder']>(async () => ({ ok: true, value: null })),
    resumeFolder: vi.fn<DesktopApi['resumeFolder']>(async () => ({ ok: true, value: null })),
    removeFolder: vi.fn<DesktopApi['removeFolder']>(async () => ({ ok: true, value: null })),
    revealFolder: vi.fn<DesktopApi['revealFolder']>(async () => undefined),
    setSyncPaused: vi.fn<DesktopApi['setSyncPaused']>(async () => undefined),
    setOpenAtLogin: vi.fn<DesktopApi['setOpenAtLogin']>(async () => undefined),
    openTeler: vi.fn<DesktopApi['openTeler']>(async () => undefined),
    setNotificationSetting: vi.fn<DesktopApi['setNotificationSetting']>(async () => undefined),
    retryFolder: vi.fn<DesktopApi['retryFolder']>(async () => ({ ok: true, value: null })),
    dismissFolderRequest: vi.fn<DesktopApi['dismissFolderRequest']>(async () => undefined),
  }
}
