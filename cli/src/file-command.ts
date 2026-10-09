import type { TelerApiClient } from './api'
import { assertNoFlags, parseLimit, takeOption } from './command-args'
import type { Output } from './chats'
import { UsageError } from './errors'
import { copyFile, listFiles, mkdir, moveFile, readFiles, searchFiles, writeFile } from './files'

type FileScope = 'organization' | 'personal' | 'organization,personal'

function takeScope(args: string[]): FileScope | undefined {
  const scope = takeOption(args, '--scope')
  if (
    scope !== undefined &&
    scope !== 'organization' &&
    scope !== 'personal' &&
    scope !== 'organization,personal'
  ) {
    throw new UsageError('--scope must be personal, organization, or organization,personal')
  }
  return scope
}

export async function runFileCommand(
  client: TelerApiClient,
  output: Output,
  action: string | undefined,
  args: string[]
): Promise<void> {
  const organizationId = takeOption(args, '--org')
  if (action === 'list') {
    const path = takeOption(args, '--path')
    const query = takeOption(args, '--query')
    const kind = takeOption(args, '--kind')
    const scope = takeScope(args)
    const limit = parseLimit(takeOption(args, '--limit'), 100, 500)
    const rawOffset = takeOption(args, '--offset')
    const offset = rawOffset === undefined ? 0 : Number(rawOffset)
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new UsageError('--offset must be a non-negative safe integer')
    }
    assertNoFlags(args)
    if (args.length > 1 || (path !== undefined && args.length > 0)) {
      throw new UsageError(
        'Usage: teler files list [--path <path>] [--query <text>] [--kind <kind>] [--scope <scope>] [--limit <count>] [--offset <count>]'
      )
    }
    return await listFiles(client, output, {
      organizationId,
      path: path ?? args[0],
      query,
      kind,
      scope,
      limit,
      offset,
    })
  }
  if (action === 'read') {
    assertNoFlags(args)
    if (args.length < 1 || args.length > 20) {
      throw new UsageError('Usage: teler files read <path>...')
    }
    return await readFiles(client, output, { organizationId, paths: args })
  }
  if (action === 'search') {
    const path = takeOption(args, '--path')
    const scope = takeScope(args)
    const limit = parseLimit(takeOption(args, '--limit'), 10, 50)
    assertNoFlags(args)
    if (args.length !== 1) throw new UsageError('Usage: teler files search <query>')
    return await searchFiles(client, output, {
      organizationId,
      query: args[0] ?? '',
      path,
      scope,
      limit,
    })
  }
  assertNoFlags(args)
  if (action === 'write') {
    if (args.length !== 2) throw new UsageError('Usage: teler files write <path> <content>')
    return await writeFile(client, output, {
      organizationId,
      path: args[0] ?? '',
      content: args[1] ?? '',
    })
  }
  if (action === 'mkdir') {
    if (args.length !== 1) throw new UsageError('Usage: teler files mkdir <path>')
    return await mkdir(client, output, { organizationId, path: args[0] ?? '' })
  }
  if (action === 'move' || action === 'copy') {
    if (args.length !== 2) throw new UsageError(`Usage: teler files ${action} <from> <to>`)
    const options = { organizationId, from: args[0] ?? '', to: args[1] ?? '' }
    return action === 'move'
      ? await moveFile(client, output, options)
      : await copyFile(client, output, options)
  }
  throw new UsageError('Unknown files command. Run `teler --help`.')
}
