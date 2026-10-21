import type { TelerApiClient } from './api'
import { resolveChatId } from './chat-id'
import { listArtifacts, listChats, showChat, type Output } from './chats'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import { emitJson } from './command-output'
import { ApiError, UsageError } from './errors'

/** Permanently deletes one of the person's own chats, as Delete in the Teler app does. */
async function deleteChat(client: TelerApiClient, output: Output, args: string[]) {
  const confirmed = takeFlag(args, '--yes')
  assertNoFlags(args)
  if (args.length !== 1) throw new UsageError('Usage: teler chat delete <chat-id-or-url> --yes')
  if (!confirmed) throw new UsageError('Deleting a chat is permanent; pass --yes to confirm.')
  const chatId = resolveChatId(args[0] ?? '')
  try {
    await client.request(`/api/chat/${chatId}?permanent=true`, { method: 'DELETE' })
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 403) throw error
    // A server that predates CLI chat deletion refuses the route itself, without a code.
    if (error.code === undefined)
      throw new ApiError(
        'This Teler server does not let the CLI delete chats yet.',
        403,
        'UNSUPPORTED_BY_SERVER',
        undefined,
        undefined,
        'Delete the chat in the Teler app.'
      )
    if (error.code === 'ACCESS_DENIED')
      throw new ApiError('You can only delete your own chats.', 403, error.code)
    throw error
  }
  if (output.json) emitJson(output, { chatId, deleted: true })
  else output.write(`Deleted chat ${chatId}.\n`)
}

/** `teler chat list|show|artifacts|delete`; `chat seen` belongs to the attention commands. */
export async function runChatCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  client: TelerApiClient,
  output: Output
): Promise<boolean> {
  if (group !== 'chat') return false
  if (action === 'list') {
    const limitRaw = takeOption(args, '--limit')
    assertNoFlags(args)
    if (args.length > 0) throw new UsageError('Usage: teler chat list [--limit <count>]')
    const limit = limitRaw ? Number(limitRaw) : 20
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new UsageError('--limit must be an integer from 1 to 100')
    }
    await listChats(client, output, limit)
    return true
  }
  if (action === 'show' || action === 'artifacts') {
    assertNoFlags(args)
    if (args.length !== 1) throw new UsageError(`Usage: teler chat ${action} <chat-id-or-url>`)
    const chatId = resolveChatId(args[0] ?? '')
    if (action === 'show') await showChat(client, output, chatId)
    else await listArtifacts(client, output, chatId)
    return true
  }
  if (action === 'delete') {
    await deleteChat(client, output, args)
    return true
  }
  return false
}
