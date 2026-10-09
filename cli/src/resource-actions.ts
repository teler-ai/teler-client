import { readFile, writeFile } from 'node:fs/promises'
import { takeFlag, takeOption, assertNoFlags } from './command-args'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { UsageError } from './errors'
import { emitResource, resourceIdSchema, resourcePath } from './read-resources'

interface ResourceAction {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  suffix: string
  body?: boolean
  childId?: boolean
  collection?: boolean
  binary?: boolean
}
const DASHBOARD_ACTIONS: Record<string, ResourceAction> = {
  visibility: { method: 'PATCH', suffix: '', body: true },
  shares: { method: 'GET', suffix: '/share' },
  share: { method: 'POST', suffix: '/share', body: true },
  unshare: { method: 'DELETE', suffix: '/share', childId: true },
  'public-links': { method: 'GET', suffix: '/public-share' },
  'create-public-link': { method: 'POST', suffix: '/public-share', body: true },
  'revoke-public-link': { method: 'DELETE', suffix: '/public-share', childId: true },
  activity: { method: 'GET', suffix: '/activity' },
  'create-post': { method: 'POST', suffix: '/post' },
  templates: { method: 'GET', suffix: '/templates', collection: true },
  'from-template': {
    method: 'POST',
    suffix: '/templates/from-template',
    collection: true,
    body: true,
  },
  'template-progress': {
    method: 'GET',
    suffix: '/templates/from-template/progress',
    collection: true,
  },
}
const POST_ACTIONS: Record<string, ResourceAction> = {
  artifact: { method: 'GET', suffix: '/artifact', childId: true },
  document: { method: 'GET', suffix: '/document', childId: true },
  comments: { method: 'GET', suffix: '/comment' },
  comment: { method: 'POST', suffix: '/comment', body: true },
  'delete-comment': { method: 'DELETE', suffix: '/comment', childId: true },
  'mark-comments-seen': { method: 'POST', suffix: '/comments/seen' },
  react: { method: 'POST', suffix: '/react', body: true },
  unreact: { method: 'DELETE', suffix: '/react', body: true },
  hide: { method: 'POST', suffix: '/hide' },
  unhide: { method: 'DELETE', suffix: '/hide' },
  visibility: { method: 'PATCH', suffix: '', body: true },
  export: { method: 'POST', suffix: '/pdf', body: true, binary: true },
}

export async function runResourceAction(
  group: 'post' | 'dashboard',
  action: string | undefined,
  args: string[],
  client: TelerApiClient,
  output: Output,
  organizationId?: string
): Promise<boolean> {
  const definition = (group === 'post' ? POST_ACTIONS : DASHBOARD_ACTIONS)[action ?? '']
  if (!definition) return false
  const file = takeOption(args, '--file')
  const destination = takeOption(args, '--output')
  const yes = takeFlag(args, '--yes')
  const download = group === 'post' && action === 'artifact' && takeFlag(args, '--download')
  const binary = definition.binary || download
  const params = new URLSearchParams()
  if (download) params.set('download', 'true')
  if (group === 'post' && action === 'document') {
    for (const [flag, key] of [
      ['--max-bytes', 'max_bytes'],
      ['--page-number', 'page_number'],
      ['--anchor', 'anchor'],
    ] as const) {
      const value = takeOption(args, flag)
      if (value !== undefined) params.set(key, value)
    }
  }
  for (const key of ['limit', 'cursor', 'chatId', 'projectId']) {
    const value = takeOption(
      args,
      `--${key === 'chatId' ? 'chat' : key === 'projectId' ? 'project' : key}`
    )
    if (value) params.set(key, value)
  }
  assertNoFlags(args)
  const expected = (definition.collection ? 0 : 1) + (definition.childId ? 1 : 0)
  if (args.length !== expected) throw new UsageError(`Invalid arguments for ${group} ${action}`)
  if (!definition.collection && !resourceIdSchema(group).safeParse(args[0]).success)
    throw new UsageError(`Invalid ${group} ID`)
  if (definition.childId && !/^[a-z]+_[0-9a-hjkmnp-tv-z]{26}$/.test(args[1] ?? ''))
    throw new UsageError('Invalid target ID')
  if (definition.method === 'DELETE' && !yes)
    throw new UsageError('Deletion or revocation requires --yes')
  if (Boolean(definition.body) !== Boolean(file))
    throw new UsageError(definition.body ? '--file is required' : '--file is not supported')
  if (Boolean(binary) !== Boolean(destination))
    throw new UsageError(binary ? '--output is required' : '--output is not supported')
  let body: string | undefined
  if (file) {
    try {
      const value: unknown = JSON.parse(await readFile(file, 'utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
      body = JSON.stringify(value)
    } catch {
      throw new UsageError('Unable to read a JSON object from --file')
    }
  }
  let resource =
    group +
    (definition.collection ? '' : `/${args[0]}`) +
    definition.suffix +
    (definition.childId ? `/${args[1]}` : '')
  if (action === 'document') resource += '/content'
  if (action === 'unreact' && body) {
    const parsed = JSON.parse(body) as { emoji?: unknown }
    if (typeof parsed.emoji !== 'string') throw new UsageError('Reaction file requires emoji')
    params.set('emoji', parsed.emoji)
    body = undefined
  }
  const path = await resourcePath(client, resource, organizationId)
  if (action === 'from-template' && body) {
    const organization = new URL(path, client.baseUrl).searchParams.get('organizationId')
    body = JSON.stringify({ ...JSON.parse(body), organizationId: organization })
  }
  const response = await client.request(path + (params.size ? `&${params}` : ''), {
    method: definition.method,
    body,
  })
  if (binary && destination) {
    await writeFile(destination, new Uint8Array(await response.arrayBuffer()))
    emitResource(output, { path: destination })
  } else emitResource(output, response.status === 204 ? { success: true } : await response.json())
  return true
}
