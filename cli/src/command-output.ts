import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { z } from 'zod'

interface MeResponse {
  activeOrganizationId: string | null
}

export function emitJson(output: Output, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`)
}

export async function resolveOrganizationId(
  client: TelerApiClient,
  organizationId?: string,
  signal?: AbortSignal
): Promise<string> {
  if (organizationId) return organizationId
  const me = await client.json<MeResponse>(
    '/api/teler-cli/me',
    z.object({ activeOrganizationId: z.string().nullable() }),
    { signal }
  )
  if (!me.activeOrganizationId) {
    throw new Error('No active organization; pass --org <organization-id>')
  }
  return me.activeOrganizationId
}

export function pathGlob(path = '/', recursive = true): string {
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path
  if (normalized.endsWith('*')) return normalized
  if (normalized === '/') return recursive ? '/**' : '/*'
  return `${normalized}/${recursive ? '**' : '*'}`
}
