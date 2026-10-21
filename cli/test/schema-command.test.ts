import { describe, expect, it } from 'bun:test'
import {
  describeDataTableInputJsonSchema,
  listDataTablesInputJsonSchema,
  listProjectsInputJsonSchema,
} from '../src/data-contract'
import type { Output } from '../src/chats'
import { UsageError } from '../src/errors'
import { runSubmitInputJsonSchemas } from '../src/run-contract'
import { CLI_SCHEMA_REGISTRY, runSchemaCommand } from '../src/schema-command'
import { USAGE } from '../src/usage'

function output(json = true) {
  let text = ''
  const target: Output = {
    json,
    metadataOnly: false,
    write: (value) => {
      text += value
    },
  }
  return { target, text: () => text }
}

/** `post|dashboard create` and friends, as command names, from every `teler …` usage line. */
function usageCommandNames(): Set<string> {
  const names = new Set<string>()
  for (const line of USAGE.split('\n')) {
    const match = /^\s{2}teler (.+)$/.exec(line)
    if (!match?.[1]) continue
    const words: string[] = []
    for (const token of match[1].split(/\s+/)) {
      if (!/^[a-z][a-z|-]*$/.test(token)) break
      words.push(token)
    }
    if (words.length === 0) {
      names.add(match[1].startsWith('--version') ? 'version' : '')
      continue
    }
    let combinations = ['']
    for (const word of words)
      combinations = combinations.flatMap((prefix) =>
        word.split('|').map((part) => (prefix ? `${prefix}.${part}` : part))
      )
    for (const name of combinations) names.add(name)
  }
  return names
}

describe('CLI schema command', () => {
  it('lists every command in the usage text, and nothing else, with a distinct description', async () => {
    const sink = output()
    expect(await runSchemaCommand('schema', undefined, [], sink.target)).toBe(true)
    const { commands } = JSON.parse(sink.text()) as {
      commands: { name: string; description: string; usage: string }[]
    }
    const names = commands.map(({ name }) => name)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(commands.map(({ description }) => description)).size).toBe(commands.length)
    expect([...usageCommandNames()].sort()).toEqual([...names].sort())
    for (const name of ['chat.delete', 'agent.setup', 'run.python', 'send', 'schedule.create'])
      expect(names).toContain(name)
    for (const command of commands) expect(command.usage.startsWith('teler ')).toBe(true)
  })

  it('maps every input field of a typed command to a flag that its usage names', () => {
    for (const entry of CLI_SCHEMA_REGISTRY) {
      if (!entry.inputSchema) continue
      const properties = Object.keys(
        (entry.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      )
      const flags = entry.flags ?? {}
      for (const property of properties.filter((property) => property !== 'task'))
        expect(flags).toHaveProperty([property])
      for (const flag of Object.values(flags)) expect(entry.usage).toContain(flag)
    }
    const python = CLI_SCHEMA_REGISTRY.find(({ name }) => name === 'run.python')
    expect(python?.flags).toMatchObject({
      timeoutSeconds: '--execution-timeout',
      maximumCredits: '--max-credits',
      'task.code': '--file',
    })
    expect(python?.inputSchema).toEqual(runSubmitInputJsonSchemas.python)
    expect(JSON.stringify(python?.inputSchema)).not.toContain('"sql"')
    expect(
      (runSubmitInputJsonSchemas.python as { properties: Record<string, unknown> }).properties
        .timeoutSeconds
    ).toMatchObject({ maximum: 3600, default: 60 })
  })

  it('returns the real input schemas with defaults and unknown-key rules', async () => {
    for (const [name, inputSchema] of [
      ['data.list', listDataTablesInputJsonSchema],
      ['data.describe', describeDataTableInputJsonSchema],
      ['project.list', listProjectsInputJsonSchema],
    ] as const) {
      const sink = output()
      const entry = CLI_SCHEMA_REGISTRY.find((candidate) => candidate.name === name)
      expect(await runSchemaCommand('schema', name, [], sink.target)).toBe(true)
      expect(JSON.parse(sink.text())).toEqual({
        command: { name: entry?.name, description: entry?.description, usage: entry?.usage },
        flags: entry?.flags,
        inputSchema: JSON.parse(JSON.stringify(inputSchema)),
      })
      expect(inputSchema).toMatchObject({ additionalProperties: false })
    }
    expect(listDataTablesInputJsonSchema.properties).toMatchObject({
      limit: { default: 50 },
      offset: { default: 0 },
    })
    expect(describeDataTableInputJsonSchema.properties?.ref).toMatchObject({ maxLength: 2_048 })
    expect(listProjectsInputJsonSchema.properties?.organizationId).not.toHaveProperty('default')
  })

  it('describes a command without a typed input by its usage', async () => {
    const sink = output()
    await runSchemaCommand('schema', 'chat.delete', [], sink.target)
    expect(JSON.parse(sink.text())).toEqual({
      command: {
        name: 'chat.delete',
        description: 'Permanently delete one of your own chats and its messages.',
        usage: 'teler chat delete <chat-id-or-url> --yes [--json]',
      },
    })
  })

  it('prints schema details for a human reader', async () => {
    const sink = output(false)
    await runSchemaCommand('schema', 'data.list', [], sink.target)
    expect(sink.text()).toContain('Command: data.list')
    expect(sink.text()).toContain('Usage: teler data list --project <id>')
    expect(sink.text()).toContain('"query": "--query"')
    expect(sink.text()).toContain('"default": 50')
  })

  it('rejects unknown schemas and extra arguments, while ignoring unrelated groups', async () => {
    const invalid = [
      ['schema', 'unknown', []],
      ['schema', undefined, ['extra']],
      ['schema', 'data.list', ['extra']],
      ['schema', 'data.describe', ['--unknown']],
    ] as const
    for (const [group, action, args] of invalid) {
      expect(() => runSchemaCommand(group, action, [...args], output().target)).toThrow(UsageError)
    }
    expect(() => runSchemaCommand('schema', undefined, ['extra'], output().target)).toThrow(
      'Usage: teler schema [command] [--json]'
    )
    expect(await runSchemaCommand('data', 'list', [], output().target)).toBe(false)
  })
})
