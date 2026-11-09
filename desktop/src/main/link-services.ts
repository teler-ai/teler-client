import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { dialog, Notification } from 'electron'
import { createCliRunner, spawnLinkHelper } from './cli-process'
import { DaemonSupervisor } from './daemon-supervisor'
import type { FetchLike } from './device-login'
import type { Translate } from './i18n'
import { createPairingCode, revokeLinkDevice } from './link-api'
import { LinkController } from './link-controller'
import { pairFeedback, stopFeedback, type LinkFeedback } from './link-feedback'
import { LinkPairingStore, pairWithSidecar } from './link-pairing'
import { electronEncryption } from './services'
import { linkSidecarEnvironment, type SidecarCommand } from './sidecar'
import { readWindowSession } from './window-session'

/** `teler link` exits with 2 when Teler no longer accepts the pairing (the computer was removed). */
const UNPAIRED_EXIT_CODE = 2

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** A short confirmation as a notification; next steps (or no notifications) as a dialog. */
async function present(feedback: LinkFeedback): Promise<void> {
  if (!feedback) return
  if (feedback.type === 'notification' && Notification.isSupported())
    return new Notification({ title: feedback.title, body: feedback.body }).show()
  await dialog.showMessageBox({
    type: feedback.type === 'dialog' ? feedback.kind : 'info',
    message: feedback.title,
    detail: feedback.type === 'dialog' ? feedback.detail : feedback.body,
  })
}

export interface LinkServicesOptions {
  origin: string
  authOrigin: string
  userData: string
  sidecar: SidecarCommand
  /** Requests with the Teler window session's cookies. */
  windowFetch: FetchLike
  /** Adds the current Cloudflare Access token to one sidecar launch. */
  withAccess(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  translate(): Translate
}

/** Teler Link: pairing with the window session and the supervised `teler link` helper. */
export function createLinkServices(options: LinkServicesOptions) {
  const { origin, sidecar } = options
  const environment = (
    pairing: { deviceId: string; organizationId: string; secret: string } | null
  ) =>
    linkSidecarEnvironment({
      base: process.env,
      origin,
      dataDir: join(options.userData, 'link'),
      home: homedir(),
      platform: process.platform,
      pairing,
    })
  let controller: LinkController | null = null
  const supervisor = new DaemonSupervisor(
    {
      spawn: (env) => spawnLinkHelper(sidecar, options.withAccess(env)),
      isFinal: (exit) => {
        if (exit.code !== UNPAIRED_EXIT_CODE) return false
        void controller?.revoked()
        return true
      },
      wait,
      now: Date.now,
    },
    () => controller?.supervisorChanged()
  )
  controller = new LinkController({
    origin,
    hostname,
    readSession: () => readWindowSession(options.authOrigin, options.windowFetch),
    createCode: (organizationId) => createPairingCode(origin, organizationId, options.windowFetch),
    revoke: (device) => revokeLinkDevice(origin, device, options.windowFetch),
    pair: (code, name) =>
      pairWithSidecar(
        createCliRunner(sidecar, () => options.withAccess(environment(null))),
        code,
        name
      ),
    store: new LinkPairingStore(join(options.userData, 'link-pairing.bin'), electronEncryption),
    environment,
    supervisor,
  })
  const link = controller
  return {
    controller: link,
    /** Relaunches a running helper so it picks up a renewed Access token. */
    relaunch: () => void supervisor.relaunch(),
    /** "Run my chats on this computer" from a Teler page, then how it went. */
    pair: async (organizationId: string) => {
      const outcome = await link.pair(organizationId)
      await present(pairFeedback(outcome, options.translate()))
    },
    /** "Stop running my chats here" from the tray. */
    stop: async () => present(stopFeedback(await link.stop(), options.translate())),
  }
}
