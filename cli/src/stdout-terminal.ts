import type { TerminalSize } from './chats'

/** The terminal stdout prints to, or nothing for a pipe, a file or a dumb terminal. */
export function stdoutTerminal(): TerminalSize | undefined {
  const { isTTY, columns, rows } = process.stdout
  if (process.env.TERM === 'dumb') return undefined
  return isTTY && columns > 0 && rows > 0
    ? { columns, rows, width: (text) => Bun.stringWidth(text) }
    : undefined
}
