import { clipboard, dialog } from 'electron'
import type { Translate } from './i18n'
import { parseMagicLink } from './magic-link'

/** File → Sign in with copied link: opens a copied Teler magic link in the window. */
export async function signInWithCopiedLink(
  origin: string,
  authOrigin: string,
  t: Translate,
  open: (url: string) => void
): Promise<void> {
  const link = parseMagicLink(await clipboard.readText(), origin, authOrigin)
  if (link) return open(link)
  await dialog.showMessageBox({
    type: 'info',
    message: t('signInLink.invalidTitle'),
    detail: t('signInLink.invalidMessage'),
  })
}
