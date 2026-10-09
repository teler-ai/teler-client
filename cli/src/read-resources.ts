import { z } from 'zod'
import type { TelerApiClient } from './api'
import { resolveCliOrganizationId, type Output } from './chats'
import { UsageError } from './errors'
import { widgetRefreshStateSchema } from './dashboard-refresh-contract'

export const resourceIdSchema = (resource: 'post' | 'dashboard') =>
  z.string().regex(new RegExp(`^${resource === 'post' ? 'post' : 'dash'}_[0-9a-hjkmnp-tv-z]{26}$`))
const dashboardIdSchema = resourceIdSchema('dashboard')
const dateSchema = z.string()
const dashboardSummarySchema = z.object({
  dashboardId: dashboardIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  refreshInterval: z.string().optional(),
  lastRefreshedAt: z.string().nullable().optional(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
})
const dashboardSchema = dashboardSummarySchema.extend({
  widgets: z.array(
    z.object({
      widgetId: z.string(),
      artifactId: z.string(),
      artifactSlug: z.string(),
      artifactType: z.string(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      position: z.record(z.string(), z.unknown()),
      sortOrder: z.number(),
      refreshState: widgetRefreshStateSchema,
    })
  ),
})
const legacyDashboardListSchema = z
  .object({ dashboards: z.array(dashboardSummarySchema), limit: z.number(), offset: z.number() })
  .transform((value) => ({
    ...value,
    items: value.dashboards.map((board) => ({ ...board, id: board.dashboardId })),
    nextCursor: null,
    hasMore: false,
  }))
const resourceSchema = z.object({ id: z.string() }).passthrough()
const listSchema = z
  .object({
    items: z.array(resourceSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .passthrough()
export interface ResourceOptions {
  organizationId?: string
  projectId?: string
  limit: number
  offset?: number
  cursor?: string
  ownership?: string
  visibility?: string
  query?: string
  sort?: string
  order?: string
  formats?: string
}
export function emitResource(output: Output, value: unknown): void {
  output.write(`${JSON.stringify(value, null, output.json ? undefined : 2)}\n`)
}
export async function resourcePath(
  client: TelerApiClient,
  resource: string,
  organizationId?: string
): Promise<string> {
  const org = await resolveCliOrganizationId(client, organizationId)
  return `/api/${resource}?${new URLSearchParams({ organizationId: org })}`
}
async function list(
  client: TelerApiClient,
  output: Output,
  resource: 'post' | 'dashboard',
  options: ResourceOptions
) {
  if (options.offset) throw new UsageError('--offset is replaced by --cursor')
  let path = await resourcePath(client, resource, options.organizationId)
  const query = new URLSearchParams({ limit: String(options.limit) })
  if (options.projectId) query.set('projectIds', options.projectId)
  for (const key of [
    'cursor',
    'ownership',
    'visibility',
    'query',
    'sort',
    'order',
    'formats',
  ] as const) {
    if (options[key]) query.set(key, options[key])
  }
  path += `&${query}`
  const result = await client.json(
    path,
    resource === 'dashboard' ? listSchema.or(legacyDashboardListSchema) : listSchema
  )
  if (output.json) return emitResource(output, result)
  if (!result.items.length) return output.write(`No ${resource}s found.\n`)
  for (const item of result.items)
    output.write(
      `${item.id}\t${String(('title' in item ? item.title : undefined) ?? item.name ?? 'Untitled')}\n`
    )
  if (result.nextCursor) output.write(`Next cursor: ${result.nextCursor}\n`)
}
export const listPosts = (client: TelerApiClient, output: Output, options: ResourceOptions) =>
  list(client, output, 'post', options)
export const listDashboards = (client: TelerApiClient, output: Output, options: ResourceOptions) =>
  list(client, output, 'dashboard', options)
async function get(
  client: TelerApiClient,
  output: Output,
  resource: 'post' | 'dashboard',
  id: string,
  organizationId?: string,
  include?: string,
  widgetIds?: string
) {
  if (!resourceIdSchema(resource).safeParse(id).success)
    throw new UsageError(`Invalid ${resource} ID`)
  const path = await resourcePath(client, `${resource}/${id}`, organizationId)
  const params = new URLSearchParams()
  if (include) params.set('include', include)
  if (widgetIds) params.set('widgetIds', widgetIds)
  emitResource(
    output,
    await client.json(
      path + (params.size ? `&${params}` : ''),
      resource === 'dashboard' ? resourceSchema.or(dashboardSchema) : resourceSchema
    )
  )
}
export const getPost = (
  client: TelerApiClient,
  output: Output,
  id: string,
  org?: string,
  include = 'both'
) => get(client, output, 'post', id, org, include)
export const getDashboard = (
  client: TelerApiClient,
  output: Output,
  id: string,
  org?: string,
  include = 'both',
  widgetIds?: string
) => get(client, output, 'dashboard', id, org, include, widgetIds)
