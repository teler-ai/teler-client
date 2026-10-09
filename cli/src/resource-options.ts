import { readFile } from 'node:fs/promises'
import { UsageError } from './errors'

export type ResourceKind = 'skill' | 'memory' | 'agent'
export type ResourceAction = 'list' | 'get' | 'create' | 'update' | 'delete'

export const RESOURCE_USAGE = `
Resource commands:
  teler skill  list [--org <id>] [--json]
  teler skill  get <id> [--json]
  teler skill  create --name <slug> --label <label> --description <text>
               --content-file <path> [--trigger <text>]... [--scope personal|organization]
               [--org <id>] [--json]
  teler skill  update <id> [--label <label>] [--description <text>]
               [--content-file <path>] [--trigger <text>]... [--clear-triggers] [--json]
  teler skill  delete <id> --yes [--json]
  teler memory list [--json]
  teler memory get <id> [--json]
  teler memory delete <id> --yes [--json]
  teler memory create --name <slug> --label <label> --description <text>
               --content-file <path> --type preference|domain|feedback|reference
               [--trigger <text>]... [--json]
  teler memory update <id> [--label <label>] [--description <text>]
               [--content-file <path>] [--trigger <text>]... [--clear-triggers]
               [--active|--inactive] [--json]
  teler agent  list [--org <id>] [--json]
  teler agent  get <id> [--json]
  teler agent  create --name <slug> --label <label> --content-file <path>
               [--description <text>] [--scope personal|organization] [--org <id>]
               [--model-set lite|pro] [--output none|private_post]
               [--quick-action|--no-quick-action] [--capabilities <capability,...>] [--json]
  teler agent  update <id> [--label <label>] [--description <text>]
               [--content-file <path>] [--model-set lite|pro]
               [--output none|private_post] [--quick-action|--no-quick-action]
               [--capabilities <capability,...>] [--json]
  teler agent  delete <id> --yes [--json]
`

export interface ResourceCommand {
  kind: ResourceKind
  action: ResourceAction
  id?: string
  organizationId?: string
  body?: Record<string, unknown>
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name)
  if (index < 0) return false
  args.splice(index, 1)
  return true
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new UsageError(`${name} requires a value`)
  args.splice(index, 2)
  return value
}

function takeOptions(args: string[], name: string): string[] {
  const values: string[] = []
  for (;;) {
    const value = takeOption(args, name)
    if (value === undefined) return values
    values.push(value)
  }
}

function required(args: string[], name: string): string {
  const value = takeOption(args, name)
  if (!value) throw new UsageError(`${name} is required`)
  return value
}

function oneOf(value: string | undefined, name: string, allowed: readonly string[]) {
  if (value !== undefined && !allowed.includes(value)) {
    throw new UsageError(`${name} must be one of ${allowed.join(', ')}`)
  }
  return value
}

function assertFinished(args: string[], usage: string): void {
  if (args.length > 0) throw new UsageError(`Usage: ${usage}`)
}

function readId(args: string[], kind: ResourceKind): string {
  const id = args.shift()
  const prefixes = { skill: 'skll', memory: 'umem', agent: 'agent' } as const
  if (!id || !new RegExp(`^${prefixes[kind]}_[0-9a-hjkmnp-tv-z]{26}$`).test(id)) {
    throw new UsageError(`Invalid ${kind} ID`)
  }
  return id
}

async function contentFrom(args: string[], requiredContent: boolean): Promise<string | undefined> {
  const path = takeOption(args, '--content-file')
  if (!path) {
    if (requiredContent) throw new UsageError('--content-file is required')
    return undefined
  }
  try {
    return await readFile(path, 'utf8')
  } catch {
    throw new UsageError('Could not read --content-file')
  }
}

function triggersFrom(args: string[]): string[] | undefined {
  const triggers = takeOptions(args, '--trigger')
  const clear = takeFlag(args, '--clear-triggers')
  if (clear && triggers.length > 0) {
    throw new UsageError('--clear-triggers cannot be combined with --trigger')
  }
  if (clear) return []
  return triggers.length > 0 ? triggers : undefined
}

function booleanPair(args: string[], yes: string, no: string): boolean | undefined {
  const positive = takeFlag(args, yes)
  const negative = takeFlag(args, no)
  if (positive && negative) throw new UsageError(`${yes} and ${no} are mutually exclusive`)
  return positive ? true : negative ? false : undefined
}

async function createBody(kind: ResourceKind, args: string[]): Promise<Record<string, unknown>> {
  const content = await contentFrom(args, true)
  const name = required(args, '--name')
  const label = required(args, '--label')
  const description = takeOption(args, '--description')
  const body: Record<string, unknown> = { name, label, content }

  if (kind === 'skill' || kind === 'memory') {
    if (!description) throw new UsageError('--description is required')
    body.description = description
    const triggers = triggersFrom(args)
    if (triggers !== undefined) body.triggers = triggers
  } else if (description !== undefined) body.description = description

  if (kind === 'memory') {
    body.type = oneOf(required(args, '--type'), '--type', [
      'preference',
      'domain',
      'feedback',
      'reference',
    ])
  } else {
    body.scope = oneOf(takeOption(args, '--scope') ?? 'personal', '--scope', [
      'personal',
      'organization',
    ])
  }

  if (kind === 'agent') {
    const modelSet = oneOf(takeOption(args, '--model-set'), '--model-set', ['lite', 'pro'])
    const output = oneOf(takeOption(args, '--output'), '--output', ['none', 'private_post'])
    const quickAction = booleanPair(args, '--quick-action', '--no-quick-action')
    const capabilities = capabilitiesFrom(args)
    if (modelSet !== undefined) body.modelSet = modelSet
    if (output !== undefined) body.output = output
    if (quickAction !== undefined) body.offerAsQuickAction = quickAction
    if (capabilities !== undefined) body.capabilities = capabilities
  }
  return body
}

/** `--capabilities a,b` declares the Agent's manifest from the Agent Access catalog. */
function capabilitiesFrom(args: string[]): string[] | undefined {
  const value = takeOption(args, '--capabilities')
  if (value === undefined) return undefined
  return value
    .split(',')
    .map((capability) => capability.trim())
    .filter(Boolean)
}

async function updateBody(kind: ResourceKind, args: string[]): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {}
  const content = await contentFrom(args, false)
  const label = takeOption(args, '--label')
  const description = takeOption(args, '--description')
  if (content !== undefined) body.content = content
  if (label !== undefined) body.label = label
  if (description !== undefined) body.description = description

  if (kind === 'skill' || kind === 'memory') {
    const triggers = triggersFrom(args)
    if (triggers !== undefined) body.triggers = triggers
  }
  if (kind === 'memory') {
    const active = booleanPair(args, '--active', '--inactive')
    if (active !== undefined) body.active = active
  }
  if (kind === 'agent') {
    const modelSet = oneOf(takeOption(args, '--model-set'), '--model-set', ['lite', 'pro'])
    const output = oneOf(takeOption(args, '--output'), '--output', ['none', 'private_post'])
    const quickAction = booleanPair(args, '--quick-action', '--no-quick-action')
    const capabilities = capabilitiesFrom(args)
    if (modelSet !== undefined) body.modelSet = modelSet
    if (output !== undefined) body.output = output
    if (quickAction !== undefined) body.offerAsQuickAction = quickAction
    if (capabilities !== undefined) body.capabilities = capabilities
  }
  if (Object.keys(body).length === 0) throw new UsageError(`${kind} update requires a field`)
  return body
}

export async function parseResourceCommand(
  kind: ResourceKind,
  rawAction: string | undefined,
  rawArgs: readonly string[]
): Promise<ResourceCommand> {
  const actions: readonly string[] = ['list', 'get', 'create', 'update', 'delete']
  if (!rawAction || !actions.includes(rawAction)) {
    throw new UsageError(`Usage: teler ${kind} <list|get|create|update|delete>`)
  }
  const action = rawAction as ResourceAction
  const args = [...rawArgs]
  const organizationId = kind === 'memory' ? undefined : takeOption(args, '--org')
  const usage = `teler ${kind} ${action}`

  if (action === 'list') {
    assertFinished(args, usage)
    return { kind, action, organizationId }
  }
  if (action === 'get') {
    const id = readId(args, kind)
    assertFinished(args, `${usage} <id>`)
    return { kind, action, id, organizationId }
  }
  if (action === 'delete') {
    const id = readId(args, kind)
    if (!takeFlag(args, '--yes')) throw new UsageError(`${kind} delete requires --yes`)
    assertFinished(args, `${usage} <id> --yes`)
    return { kind, action, id, organizationId }
  }
  if (action === 'create') {
    const body = await createBody(kind, args)
    assertFinished(args, usage)
    return { kind, action, organizationId, body }
  }

  const id = readId(args, kind)
  const body = await updateBody(kind, args)
  assertFinished(args, `${usage} <id> [fields]`)
  return { kind, action, id, organizationId, body }
}
