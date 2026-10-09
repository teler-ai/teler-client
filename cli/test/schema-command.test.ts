import { describe, expect, it } from 'bun:test'
import {
  describeDataTableInputJsonSchema,
  listDataTablesInputJsonSchema,
  listProjectsInputJsonSchema,
} from '../src/data-contract'
import type { Output } from '../src/chats'
import { UsageError } from '../src/errors'
import { CLI_SCHEMA_REGISTRY, runSchemaCommand } from '../src/schema-command'

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

describe('CLI schema command', () => {
  it('lists the registered command names and descriptions as JSON', async () => {
    const sink = output()

    expect(await runSchemaCommand('schema', undefined, [], sink.target)).toBe(true)
    expect(JSON.parse(sink.text())).toEqual({
      commands: CLI_SCHEMA_REGISTRY.map(({ name, description }) => ({ name, description })),
    })
  })

  it('returns the real input schemas with defaults and unknown-key rules', async () => {
    for (const [name, inputSchema] of [
      ['data.list', listDataTablesInputJsonSchema],
      ['data.describe', describeDataTableInputJsonSchema],
      ['project.list', listProjectsInputJsonSchema],
    ] as const) {
      const sink = output()
      const entry = CLI_SCHEMA_REGISTRY.find((candidate) => candidate.name === name)
      expect(entry).toBeDefined()
      expect(await runSchemaCommand('schema', name, [], sink.target)).toBe(true)
      expect(JSON.parse(sink.text())).toEqual({
        command: { name: entry?.name, description: entry?.description },
        inputSchema: JSON.parse(JSON.stringify(inputSchema)),
      })
      expect(inputSchema).toMatchObject({ additionalProperties: false })
    }

    expect(listDataTablesInputJsonSchema.properties).toMatchObject({
      limit: { default: 50 },
      offset: { default: 0 },
    })
    expect(describeDataTableInputJsonSchema.properties).toMatchObject({
      limit: { default: 100 },
      offset: { default: 0 },
    })
    expect(describeDataTableInputJsonSchema.properties?.ref).toMatchObject({ maxLength: 2_048 })
    expect(listProjectsInputJsonSchema.properties?.organizationId).not.toHaveProperty('default')
  })

  it('prints schema details for a human reader', async () => {
    const sink = output(false)

    await runSchemaCommand('schema', 'data.list', [], sink.target)

    expect(sink.text()).toContain('Command: data.list')
    expect(sink.text()).toContain('Maximum number of tables to return.')
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

    expect(await runSchemaCommand('data', 'list', [], output().target)).toBe(false)
  })
})
