import { describe, expect, it } from 'vitest'
import type { SupervisorState } from '../../src/main/daemon-supervisor'
import { LinkError } from '../../src/main/link-api'
import { LinkController, type LinkControllerDeps } from '../../src/main/link-controller'
import { pairFeedback, stopFeedback } from '../../src/main/link-feedback'
import type { LinkPairResult, StoredLinkPairing } from '../../src/main/link-pairing'
import { createTranslator } from '../../src/main/i18n'
import { buildTrayMenu, type TrayState } from '../../src/main/tray-menu'
import type { SessionUser } from '../../src/main/window-session'

const ORIGIN = 'https://app.teler.example'
const ORG = 'org_01h455vb4pex5vsknk084sn02q'
const OTHER_ORG = 'org_01h455vb4pex5vsknk084sn02r'
const DEVICE = 'lnkdev_01h455vb4pex5vsknk084sn02s'
const OTHER_DEVICE = 'lnkdev_01h455vb4pex5vsknk084sn02t'
const SECRET = `tlk_${'a'.repeat(43)}`
const OTHER_SECRET = `tlk_${'b'.repeat(43)}`
const t = createTranslator('en')

function harness(options: { stored?: StoredLinkPairing | null } = {}) {
  let user: SessionUser | undefined = { id: 'user_1' }
  let stored: StoredLinkPairing | null = options.stored ?? null
  let state: SupervisorState = 'stopped'
  const calls: string[] = []
  const starts: NodeJS.ProcessEnv[] = []
  const revoked: Array<{ deviceId: string; organizationId: string }> = []
  let codeResult: () => Promise<string> = async () => 'AB12C-DE34F'
  let pairResult: (code: string) => Promise<LinkPairResult> = async () => ({
    deviceId: DEVICE,
    organizationId: ORG,
    secret: SECRET,
    engines: [{ engine: 'claude_code', signedIn: true }],
  })
  const deps: LinkControllerDeps = {
    origin: ORIGIN,
    hostname: () => 'studio-mac',
    readSession: async () => user,
    createCode: async (organizationId) => {
      calls.push(`code:${organizationId}`)
      return codeResult()
    },
    revoke: async (device) => {
      calls.push(`revoke:${device.deviceId}`)
      revoked.push(device)
    },
    pair: async (code, name) => {
      calls.push(`pair:${code}:${name}`)
      return pairResult(code)
    },
    store: {
      read: async (origin) => (stored?.origin === origin ? stored : null),
      write: async (pairing) => {
        calls.push('write')
        stored = pairing
      },
      clear: async () => {
        calls.push('clear')
        stored = null
      },
    },
    environment: (pairing) => ({ TELER_LINK_PAIRING: JSON.stringify(pairing) }),
    supervisor: {
      get state() {
        return state
      },
      start: async (env) => {
        calls.push('start')
        starts.push(env)
        state = 'running'
      },
      stop: async () => {
        calls.push('stop')
        state = 'stopped'
      },
      shutdown: async () => {
        state = 'stopped'
      },
    },
  }
  const controller = new LinkController(deps)
  return {
    controller,
    calls,
    starts,
    revoked,
    stored: () => stored,
    setUser: (next: SessionUser | undefined) => (user = next),
    setCode: (next: () => Promise<string>) => (codeResult = next),
    setPair: (next: () => Promise<LinkPairResult>) => (pairResult = next),
  }
}

const storedPairing = (overrides: Partial<StoredLinkPairing> = {}): StoredLinkPairing => ({
  origin: ORIGIN,
  userId: 'user_1',
  deviceId: DEVICE,
  organizationId: ORG,
  secret: SECRET,
  ...overrides,
})

describe('pairing Teler Link from Teler Desktop', () => {
  it('makes a code, pairs through the sidecar, keeps the secret and runs the helper', async () => {
    const { controller, calls, starts, stored } = harness()
    const outcome = await controller.pair(ORG)
    expect(outcome).toEqual({ kind: 'paired', engine: 'claude_code', signedOutEngine: null })
    expect(calls).toEqual([`code:${ORG}`, 'pair:AB12C-DE34F:studio-mac', 'write', 'start'])
    expect(stored()).toEqual(storedPairing())
    expect(JSON.parse(starts[0]!.TELER_LINK_PAIRING!).secret).toBe(SECRET)
    expect(controller.state).toEqual({ status: 'running' })
    expect(pairFeedback(outcome, t)).toEqual({
      type: 'notification',
      title: 'Teler Link is on',
      body: 'This computer now runs your Teler chats with Claude Code.',
    })
  })

  it('explains that Teler Link is off and pairs nothing', async () => {
    const { controller, calls, stored, setCode } = harness()
    setCode(async () => {
      throw new LinkError('link-off')
    })
    const outcome = await controller.pair(ORG)
    expect(outcome).toEqual({ kind: 'failed', problem: 'link-off' })
    expect(calls).toEqual([`code:${ORG}`])
    expect(stored()).toBeNull()
    expect(controller.state).toBeNull()
    expect(pairFeedback(outcome, t)).toMatchObject({
      type: 'dialog',
      title: 'Teler Link is off for this organization',
    })
  })

  it('asks to sign in when the window is signed out', async () => {
    const { controller, calls, setUser } = harness()
    setUser(null)
    expect(await controller.pair(ORG)).toEqual({ kind: 'failed', problem: 'signed-out' })
    expect(calls).toEqual([])
  })

  it('pairs but asks to sign in to an engine that is signed out', async () => {
    const { controller, setPair, calls } = harness()
    setPair(async () => ({
      deviceId: DEVICE,
      organizationId: ORG,
      secret: SECRET,
      engines: [{ engine: 'claude_code', signedIn: false }],
    }))
    const outcome = await controller.pair(ORG)
    expect(outcome).toEqual({ kind: 'paired', engine: null, signedOutEngine: 'claude_code' })
    expect(calls).toContain('start')
    expect(pairFeedback(outcome, t)).toEqual({
      type: 'dialog',
      kind: 'info',
      title: 'Sign in to Claude Code to run your chats here',
      detail: expect.stringContaining('claude auth login'),
    })
    expect(pairFeedback({ kind: 'paired', engine: null, signedOutEngine: null }, t)).toMatchObject({
      title: 'Install Claude Code or Codex to run your chats here',
    })
  })

  it('confirms instead of pairing again while already paired and running', async () => {
    const { controller, calls } = harness({ stored: storedPairing() })
    await controller.init()
    expect(calls).toEqual(['start'])
    const outcome = await controller.pair(ORG)
    expect(outcome).toEqual({ kind: 'already-running' })
    expect(calls).toEqual(['start', 'start'])
    expect(pairFeedback(outcome, t)).toMatchObject({
      type: 'notification',
      title: 'Teler Link is already running on this computer',
    })
  })

  it('ignores a second request while one is still pairing', async () => {
    const { controller, setPair } = harness()
    let release: () => void = () => undefined
    setPair(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ deviceId: DEVICE, organizationId: ORG, secret: SECRET, engines: [] })
        })
    )
    const first = controller.pair(ORG)
    expect(await controller.pair(ORG)).toEqual({ kind: 'busy' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    expect((await first).kind).toBe('paired')
  })

  it('replaces the pairing of another organization, removing the old computer first', async () => {
    const { controller, calls, revoked, stored, setPair } = harness({ stored: storedPairing() })
    await controller.init()
    setPair(async () => ({
      deviceId: OTHER_DEVICE,
      organizationId: OTHER_ORG,
      secret: OTHER_SECRET,
      engines: [{ engine: 'codex', signedIn: true }],
    }))
    const outcome = await controller.pair(OTHER_ORG)
    expect(outcome).toEqual({ kind: 'paired', engine: 'codex', signedOutEngine: null })
    expect(calls).toEqual([
      'start',
      `code:${OTHER_ORG}`,
      'pair:AB12C-DE34F:studio-mac',
      'stop',
      `revoke:${DEVICE}`,
      'write',
      'start',
    ])
    // Only the computer's identity reaches the request, never its secret.
    expect(revoked).toEqual([{ deviceId: DEVICE, organizationId: ORG }])
    expect(stored()).toEqual(
      storedPairing({ deviceId: OTHER_DEVICE, organizationId: OTHER_ORG, secret: OTHER_SECRET })
    )
  })

  it('keeps the old pairing when the new organization refuses', async () => {
    const { controller, calls, stored, setCode } = harness({ stored: storedPairing() })
    await controller.init()
    setCode(async () => {
      throw new LinkError('link-off')
    })
    expect(await controller.pair(OTHER_ORG)).toEqual({ kind: 'failed', problem: 'link-off' })
    expect(calls).toEqual(['start', `code:${OTHER_ORG}`])
    expect(stored()).toEqual(storedPairing())
    expect(controller.state).toEqual({ status: 'running' })
  })
})

describe('Teler Link follows the window session', () => {
  it('runs only while the account that paired is signed in', async () => {
    const { controller, calls, setUser } = harness({ stored: storedPairing() })
    await controller.init()
    expect(controller.state).toEqual({ status: 'running' })
    setUser(null)
    await controller.check()
    expect(controller.state).toEqual({ status: 'stopped' })
    // Offline: the last decision holds.
    setUser(undefined)
    await controller.check()
    expect(controller.state).toEqual({ status: 'stopped' })
    setUser({ id: 'user_2' })
    await controller.check()
    expect(controller.state).toEqual({ status: 'stopped' })
    setUser({ id: 'user_1' })
    await controller.check()
    expect(controller.state).toEqual({ status: 'running' })
    expect(calls).toEqual(['start', 'stop', 'stop', 'stop', 'start'])
  })

  it('does nothing without a pairing', async () => {
    const { controller, calls } = harness()
    await controller.init()
    await controller.check()
    expect(calls).toEqual([])
    expect(controller.state).toBeNull()
  })

  it('stops, removes this computer from Teler and forgets the secret', async () => {
    const { controller, calls, stored } = harness({ stored: storedPairing() })
    await controller.init()
    expect(await controller.stop()).toBe(true)
    expect(calls).toEqual(['start', 'stop', `revoke:${DEVICE}`, 'clear'])
    expect(stored()).toBeNull()
    expect(controller.state).toBeNull()
    expect(stopFeedback(true, t)).toMatchObject({ type: 'notification' })
  })

  it('marks this computer only for the account that paired it', async () => {
    const { controller, setUser } = harness({ stored: storedPairing() })
    let changes = 0
    controller.onChange(() => (changes += 1))
    await controller.init()
    expect(controller.deviceId).toBe(DEVICE)
    const before = changes
    setUser({ id: 'user_2' })
    await controller.check()
    expect(controller.deviceId).toBeNull()
    expect(changes).toBeGreaterThan(before)
    const after = changes
    setUser({ id: 'user_1' })
    await controller.check()
    expect(controller.deviceId).toBe(DEVICE)
    expect(changes).toBeGreaterThan(after)
  })

  it("does not ask Teler to remove another account's computer", async () => {
    const { controller, calls, stored, setUser } = harness({ stored: storedPairing() })
    await controller.init()
    setUser({ id: 'user_2' })
    // Teler would not find it under this account: the person removes it there instead.
    expect(await controller.stop()).toBe(false)
    expect(calls).not.toContain(`revoke:${DEVICE}`)
    expect(stored()).toBeNull()
    expect(controller.state).toBeNull()
  })

  it('forgets a computer Teler no longer accepts', async () => {
    const { controller, stored } = harness({ stored: storedPairing() })
    await controller.init()
    await controller.revoked()
    expect(stored()).toBeNull()
    expect(controller.state).toBeNull()
  })
})

describe('Teler Link in the tray', () => {
  const base: TrayState = {
    health: 'up-to-date',
    connection: { status: 'connected', account: { id: 'u', name: 'Ana' }, error: null },
    syncPaused: false,
    openAtLogin: false,
    openAtLoginAvailable: false,
    folders: [],
    organizations: [],
    activeOrganizationId: null,
    activity: null,
  }

  it('shows nothing until this computer is paired', () => {
    const items = buildTrayMenu({ ...base, link: null }, t)
    expect(items.some((item) => item.type === 'action' && item.action === 'stop-link')).toBe(false)
  })

  it('shows whether the helper runs, and how to stop it', () => {
    const running = buildTrayMenu({ ...base, link: { status: 'running' } }, t)
    expect(running).toContainEqual({ type: 'label', label: 'Teler Link: running' })
    expect(running).toContainEqual({
      type: 'action',
      action: 'stop-link',
      label: 'Stop running my chats here',
    })
    const stopped = buildTrayMenu({ ...base, link: { status: 'stopped' } }, t)
    expect(stopped).toContainEqual({ type: 'label', label: 'Teler Link: stopped' })
  })
})
