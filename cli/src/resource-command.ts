import { readSse } from './sse'
import { runResourceAction } from './resource-actions'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { takeFlag } from './command-args'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { UsageError } from './errors'
import {
  getDashboard,
  getPost,
  listDashboards,
  listPosts,
  resourcePath,
  resourceIdSchema,
  emitResource,
} from './read-resources'

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new UsageError(`${name} requires a value`)
  args.splice(index, 2)
  return value
}

function parseInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number
): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (
    !Number.isInteger(value) ||
    value < min ||
    value > (name === '--limit' ? 100 : Number.MAX_SAFE_INTEGER)
  ) {
    throw new UsageError(
      `${name} must be an integer ${name === '--limit' ? 'from 1 to 100' : 'of 0 or greater'}`
    )
  }
  return value
}

export async function runResourceCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  client: TelerApiClient,
  output: Output
): Promise<boolean> {
  if (group === 'artifact' && action === 'source') {
    const organizationId = takeOption(args, '--org')
    if (args.length !== 1 || !/^artifact_[0-9a-hjkmnp-tv-z]{26}$/.test(args[0] ?? ''))
      throw new UsageError('Usage: teler artifact source <artifact-id> [--org <id>]')
    const path = await resourcePath(client, `artifact/${args[0]}/source`, organizationId)
    emitResource(
      output,
      await client.json(path, z.object({ timestamp: z.string(), source: z.string() }).strict())
    )
    return true
  }
  if (group !== 'post' && group !== 'dashboard') return false
  const organizationId = takeOption(args, '--org')
  if (await runResourceAction(group, action, args, client, output, organizationId)) return true
  if (action === 'list') {
    const projectId = takeOption(args, '--project')
    const limit = parseInteger(takeOption(args, '--limit'), '--limit', 20, 1)
    const offset = parseInteger(takeOption(args, '--offset'), '--offset', 0, 0)
    const filters = Object.fromEntries(
      [
        'cursor',
        'ownership',
        'visibility',
        'query',
        'sort',
        'order',
        ...(group === 'post' ? ['formats'] : []),
      ].map((key) => [key, takeOption(args, `--${key}`)])
    )
    if (args.some((arg) => arg.startsWith('-'))) throw new UsageError('Unknown option')
    if (args.length > 0) throw new UsageError(`Usage: teler ${group} list [options]`)
    const options = { organizationId, projectId, limit, offset, ...filters }
    if (group === 'post') await listPosts(client, output, options)
    else await listDashboards(client, output, options)
    return true
  }
  if (action === 'get') {
    const widgetIds = group === 'dashboard' ? takeOption(args, '--widget-ids') : undefined
    const include = takeOption(args, '--include') ?? 'both'
    if (include && !['metadata', 'data', 'both'].includes(include))
      throw new UsageError('--include must be metadata, data, or both')
    if (args.some((arg) => arg.startsWith('-')) || args.length !== 1) {
      throw new UsageError(`Usage: teler ${group} get <${group}-id> [--org <id>]`)
    }
    if (group === 'post') await getPost(client, output, args[0] ?? '', organizationId, include)
    else await getDashboard(client, output, args[0] ?? '', organizationId, include, widgetIds)
    return true
  }
  if (['create', 'update', 'delete', 'refresh', 'move', 'generate'].includes(action ?? '')) {
    const file = takeOption(args, '--file')
    const yes = takeFlag(args, '--yes')
    const idempotencyKey = takeOption(args, '--idempotency-key')
    if (args.some((arg) => arg.startsWith('-'))) throw new UsageError('Unknown option')
    const creating = action === 'create'
    if (args.length !== (creating ? 0 : 1))
      throw new UsageError(
        `Usage: teler ${group} ${action} ${creating ? '' : '<id>'} [--file <json-file>]`
      )
    if (!creating && !resourceIdSchema(group).safeParse(args[0]).success)
      throw new UsageError(`Invalid ${group} ID`)
    if (action === 'delete' && !yes) throw new UsageError('Deletion requires --yes')
    if (action === 'refresh' && group !== 'dashboard')
      throw new UsageError('Only dashboards support refresh')
    if (action === 'generate' && group !== 'post')
      throw new UsageError('Only posts support generate')
    const needsBody = ['create', 'update', 'move', 'generate'].includes(action ?? '')
    if (needsBody && !file) throw new UsageError('--file is required')
    if (!needsBody && file) throw new UsageError('--file is not supported for this operation')
    let body: string | undefined
    if (file) {
      try {
        const value: unknown = JSON.parse(await readFile(file, 'utf8'))
        if (!z.record(z.string(), z.unknown()).safeParse(value).success) throw new Error()
        body = JSON.stringify(value)
      } catch {
        throw new UsageError('Unable to read a JSON object from --file')
      }
    }
    const suffix =
      action === 'move'
        ? '/project'
        : action === 'refresh'
          ? '/refresh'
          : action === 'generate'
            ? '/generate'
            : ''
    const path = await resourcePath(
      client,
      group + (creating ? '' : `/${args[0]}`) + suffix,
      organizationId
    )
    if (creating && group === 'dashboard' && body) {
      const organization = new URL(path, client.baseUrl).searchParams.get('organizationId')
      body = JSON.stringify({ ...JSON.parse(body), organizationId: organization })
    }
    const response = await client.request(path, {
      method:
        action === 'delete'
          ? 'DELETE'
          : ['update', 'move'].includes(action ?? '')
            ? 'PATCH'
            : 'POST',
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    })
    if (
      action === 'generate' &&
      response.body &&
      response.headers.get('Content-Type')?.includes('text/event-stream')
    ) {
      let completed = false
      for await (const event of readSse(response.body)) {
        if (event.kind !== 'data') continue
        if (event.value && typeof event.value === 'object' && 'type' in event.value) {
          if (event.value.type === 'error') throw new Error('Post draft generation failed')
          if (event.value.type === 'complete') completed = true
        }
        emitResource(output, event.value)
      }
      if (!completed) throw new Error('Post draft generation did not complete')
      return true
    }
    emitResource(output, response.status === 204 ? { deleted: true } : await response.json())
    return true
  }
  throw new UsageError(
    `Unknown ${group} command. Use list, get, create, update, delete, move, or ${group === 'dashboard' ? 'refresh' : 'generate'}.`
  )
}
