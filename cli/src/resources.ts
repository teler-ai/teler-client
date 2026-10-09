import { z } from 'zod'
import type { TelerApiClient } from './api'
import { ApiError } from './errors'
import { resolveCliOrganizationId, type Output } from './chats'
import type { ResourceCommand, ResourceKind } from './resource-options'

const typeIdSuffix = '[0-9a-hjkmnp-tv-z]{26}'
const idSchemas = {
  skill: z.string().regex(new RegExp(`^skll_${typeIdSuffix}$`)),
  memory: z.string().regex(new RegExp(`^umem_${typeIdSuffix}$`)),
  agent: z.string().regex(new RegExp(`^agent_${typeIdSuffix}$`)),
} as const

const skillSchema = z
  .object({
    id: idSchemas.skill,
    name: z.string(),
    label: z.string(),
    description: z.string().nullable().optional(),
    scope: z.enum(['personal', 'organization']).optional(),
  })
  .passthrough()
const memorySchema = z
  .object({
    id: idSchemas.memory,
    name: z.string(),
    label: z.string(),
    type: z.enum(['preference', 'domain', 'feedback', 'reference']),
    active: z.boolean(),
  })
  .passthrough()
const agentSchema = z
  .object({
    id: idSchemas.agent,
    name: z.string(),
    label: z.string().optional(),
    scope: z.enum(['personal', 'organization']).optional(),
  })
  .passthrough()
const skillListSchema = z.object({ skills: z.array(skillSchema) })
const memoryListSchema = z.object({ memories: z.array(memorySchema) })
const agentListSchema = z.object({ agents: z.array(agentSchema) })
const memoryResponseSchema = z.object({ memory: memorySchema })

function emitValue(output: Output, value: unknown): void {
  output.write(`${JSON.stringify(value, null, output.json ? undefined : 2)}\n`)
}

function emitList(
  output: Output,
  kind: ResourceKind,
  value: { id: string; label?: string; name: string; scope?: string; active?: boolean }[]
): void {
  if (output.json) {
    const key = kind === 'skill' ? 'skills' : kind === 'memory' ? 'memories' : 'agents'
    emitValue(output, { [key]: value })
    return
  }
  if (value.length === 0) {
    output.write(`No ${kind === 'memory' ? 'memories' : `${kind}s`} found.\n`)
    return
  }
  for (const item of value) {
    const state = item.active === undefined ? item.scope : item.active ? 'active' : 'inactive'
    output.write(`${item.id}\t${item.label ?? item.name}${state ? `\t${state}` : ''}\n`)
  }
}

async function organizationId(client: TelerApiClient, command: ResourceCommand): Promise<string> {
  return resolveCliOrganizationId(client, command.organizationId)
}

function body(command: ResourceCommand, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...command.body, ...extra })
}

async function listSkills(client: TelerApiClient, organization: string) {
  return client.json(
    `/api/skills?organizationId=${encodeURIComponent(organization)}`,
    skillListSchema
  )
}

async function listAgents(client: TelerApiClient, organization: string) {
  return client.json(
    `/api/agent?organizationId=${encodeURIComponent(organization)}`,
    agentListSchema
  )
}

async function runSkill(client: TelerApiClient, output: Output, command: ResourceCommand) {
  if (command.action === 'list') {
    const result = await listSkills(client, await organizationId(client, command))
    return emitList(output, 'skill', result.skills)
  }
  if (command.action === 'get') {
    return emitValue(output, await client.json(`/api/skills/${command.id}`, skillSchema))
  }
  if (command.action === 'create') {
    const created = await client.json('/api/skills', skillSchema, {
      method: 'POST',
      body: body(command, { organizationId: await organizationId(client, command) }),
    })
    return emitValue(output, created)
  }
  if (command.action === 'update') {
    const updated = await client.json(`/api/skills/${command.id}`, skillSchema, {
      method: 'PUT',
      body: body(command),
    })
    return emitValue(output, updated)
  }
  await client.request(`/api/skills/${command.id}`, { method: 'DELETE' })
  emitDeleted(output, 'skill', command.id ?? '')
}

async function runMemory(client: TelerApiClient, output: Output, command: ResourceCommand) {
  if (command.action === 'list' || command.action === 'get') {
    const result = await client.json('/api/memory', memoryListSchema)
    if (command.action === 'list') return emitList(output, 'memory', result.memories)
    const memory = result.memories.find((entry) => entry.id === command.id)
    if (!memory) throw new ApiError('Memory not found', 404)
    return emitValue(output, memory)
  }
  if (command.action === 'create') {
    const created = await client.json('/api/memory', memoryResponseSchema, {
      method: 'POST',
      body: body(command),
    })
    return emitValue(output, created.memory)
  }
  if (command.action === 'update') {
    const updated = await client.json(`/api/memory/${command.id}`, memoryResponseSchema, {
      method: 'PATCH',
      body: body(command),
    })
    return emitValue(output, updated.memory)
  }
  await client.request(`/api/memory/${command.id}`, { method: 'DELETE' })
  emitDeleted(output, 'memory', command.id ?? '')
}

async function runAgent(client: TelerApiClient, output: Output, command: ResourceCommand) {
  if (command.action === 'list') {
    const result = await listAgents(client, await organizationId(client, command))
    return emitList(output, 'agent', result.agents)
  }
  if (command.action === 'get') {
    return emitValue(output, await client.json(`/api/agent/${command.id}`, agentSchema))
  }
  if (command.action === 'create') {
    const created = await client.json('/api/agent', agentSchema, {
      method: 'POST',
      body: body(command, { organizationId: await organizationId(client, command) }),
    })
    return emitValue(output, created)
  }
  if (command.action === 'update') {
    const updated = await client.json(`/api/agent/${command.id}`, agentSchema, {
      method: 'PATCH',
      body: body(command),
    })
    return emitValue(output, updated)
  }
  await client.request(`/api/agent/${command.id}`, { method: 'DELETE' })
  // Deleting archives an Agent: it can be brought back from the Agents page for 30 days.
  if (output.json) emitValue(output, { deleted: true, id: command.id ?? '' })
  else
    output.write(
      `Deleted agent ${command.id ?? ''}. You can restore it from the Agents page for 30 days.\n`
    )
}

function emitDeleted(output: Output, kind: ResourceKind, id: string): void {
  if (output.json) emitValue(output, { deleted: true, id })
  else output.write(`Deleted ${kind} ${id}.\n`)
}

export async function runResourceCommand(
  client: TelerApiClient,
  output: Output,
  command: ResourceCommand
): Promise<void> {
  if (command.kind === 'skill') return runSkill(client, output, command)
  if (command.kind === 'memory') return runMemory(client, output, command)
  return runAgent(client, output, command)
}
