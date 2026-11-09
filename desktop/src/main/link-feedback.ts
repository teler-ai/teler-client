import type { MessageKey, Translate } from './i18n'
import type { LinkProblem } from './link-api'
import type { LinkEngine, LinkPairOutcome } from './link-controller'

/** What the person sees after asking for Teler Link: a notification, a dialog, or nothing. */
export type LinkFeedback =
  | { type: 'notification'; title: string; body: string }
  | { type: 'dialog'; kind: 'info' | 'warning'; title: string; detail: string }
  | null

/** Product names, the same in every language. */
const ENGINE_NAMES: Record<LinkEngine, string> = { claude_code: 'Claude Code', codex: 'Codex' }
/** How each engine signs in from a terminal. */
const SIGN_IN_COMMANDS: Record<LinkEngine, string> = {
  claude_code: 'claude auth login',
  codex: 'codex login',
}

const PROBLEM_KEYS: Record<LinkProblem, [title: MessageKey, detail: MessageKey]> = {
  'signed-out': ['link.error.signedOut.title', 'link.error.signedOut.detail'],
  'link-off': ['link.error.off.title', 'link.error.off.detail'],
  'link-restricted': ['link.error.restricted.title', 'link.error.restricted.detail'],
  'not-member': ['link.error.notMember.title', 'link.error.notMember.detail'],
  'update-required': ['link.error.update.title', 'link.error.update.detail'],
  network: ['link.error.network.title', 'link.error.network.detail'],
  failed: ['link.error.failed.title', 'link.error.failed.detail'],
}

/** After "Run my chats on this computer". */
export function pairFeedback(outcome: LinkPairOutcome, t: Translate): LinkFeedback {
  switch (outcome.kind) {
    case 'busy':
      return null
    case 'already-running':
      return {
        type: 'notification',
        title: t('link.alreadyRunning.title'),
        body: t('link.alreadyRunning.body'),
      }
    case 'failed': {
      const [title, detail] = PROBLEM_KEYS[outcome.problem]
      return { type: 'dialog', kind: 'warning', title: t(title), detail: t(detail) }
    }
    case 'paired': {
      if (outcome.engine)
        return {
          type: 'notification',
          title: t('link.paired.title'),
          body: t('link.paired.body', { engine: ENGINE_NAMES[outcome.engine] }),
        }
      const engine = outcome.signedOutEngine
      if (engine)
        return {
          type: 'dialog',
          kind: 'info',
          title: t('link.engineSignedOut.title', { engine: ENGINE_NAMES[engine] }),
          detail: t('link.engineSignedOut.detail', { command: SIGN_IN_COMMANDS[engine] }),
        }
      return {
        type: 'dialog',
        kind: 'info',
        title: t('link.engineMissing.title'),
        detail: t('link.engineMissing.detail'),
      }
    }
  }
}

/** After "Stop running my chats here"; `removed` is whether Teler could be told. */
export function stopFeedback(removed: boolean, t: Translate): LinkFeedback {
  return removed
    ? { type: 'notification', title: t('link.stopped.title'), body: t('link.stopped.body') }
    : {
        type: 'dialog',
        kind: 'info',
        title: t('link.stopped.notRemoved.title'),
        detail: t('link.stopped.notRemoved.detail'),
      }
}
