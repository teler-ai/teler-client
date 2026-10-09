import { clipboard, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { Translate } from './i18n'

/** The fields of Electron's `context-menu` parameters that the menu reads. */
export interface ContextMenuParams {
  isEditable: boolean
  selectionText: string
  linkURL: string
  misspelledWord: string
  dictionarySuggestions: string[]
  editFlags: {
    canUndo: boolean
    canRedo: boolean
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canSelectAll: boolean
  }
}

type EditRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'

export type ContextMenuItem =
  | { type: 'separator' }
  | { type: 'suggestion'; word: string; label: string }
  | { type: 'add-to-dictionary'; word: string; label: string }
  | { type: 'role'; role: EditRole; label: string; enabled: boolean }
  | { type: 'copy-link'; url: string; label: string }

const MAX_SUGGESTIONS = 5

function isWebLink(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:')
}

/**
 * Electron shows no context menu by default. This one offers what a browser
 * does for text: spelling suggestions, editing, copying and copying links.
 */
export function buildContextMenu(params: ContextMenuParams, t: Translate): ContextMenuItem[] {
  const groups: ContextMenuItem[][] = []
  const flags = params.editFlags
  const role = (name: EditRole, enabled: boolean): ContextMenuItem => ({
    type: 'role',
    role: name,
    label: t(`menu.${name}`),
    enabled,
  })
  if (params.isEditable && params.misspelledWord)
    groups.push([
      ...params.dictionarySuggestions
        .slice(0, MAX_SUGGESTIONS)
        .map((word): ContextMenuItem => ({ type: 'suggestion', word, label: word })),
      {
        type: 'add-to-dictionary',
        word: params.misspelledWord,
        label: t('contextMenu.addToDictionary'),
      },
    ])
  if (params.linkURL && isWebLink(params.linkURL))
    groups.push([{ type: 'copy-link', url: params.linkURL, label: t('contextMenu.copyLink') }])
  if (params.isEditable)
    groups.push(
      [role('undo', flags.canUndo), role('redo', flags.canRedo)],
      [role('cut', flags.canCut), role('copy', flags.canCopy), role('paste', flags.canPaste)],
      [role('selectAll', flags.canSelectAll)]
    )
  else if (params.selectionText.trim()) groups.push([role('copy', flags.canCopy)])
  return groups.flatMap((group, index) =>
    index === 0 ? group : [{ type: 'separator' } as const, ...group]
  )
}

/** Shows the context menu for every page in these contents. */
export function attachContextMenu(contents: WebContents, translate: () => Translate): void {
  contents.on('context-menu', (_event, params) => {
    const items = buildContextMenu(params, translate())
    if (items.length === 0) return
    const template = items.map((item): MenuItemConstructorOptions => {
      switch (item.type) {
        case 'separator':
          return { type: 'separator' }
        case 'suggestion':
          return { label: item.label, click: () => contents.replaceMisspelling(item.word) }
        case 'add-to-dictionary':
          return {
            label: item.label,
            click: () => contents.session.addWordToSpellCheckerDictionary(item.word),
          }
        case 'role':
          return { role: item.role, label: item.label, enabled: item.enabled }
        case 'copy-link':
          return { label: item.label, click: () => clipboard.writeText(item.url) }
      }
    })
    Menu.buildFromTemplate(template).popup()
  })
}
