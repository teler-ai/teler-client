import type { Output } from './chats'
import { emitJson } from './command-output'
import {
  describeDataTableInputJsonSchema,
  listDataTablesInputJsonSchema,
  listProjectsInputJsonSchema,
} from './data-contract'
import { UsageError } from './errors'
import { runSelectionInputJsonSchema, runSubmitInputJsonSchema } from './run-contract'
import { artifactGetInputJsonSchema } from './artifact-command'

export interface CliSchemaEntry {
  name: string
  description: string
  inputSchema: object
}

/** Public CLI input contracts available to an agent before it invokes a command. */
export const CLI_SCHEMA_REGISTRY = [
  {
    name: 'artifact.get',
    description: 'Inspect artifact metadata or download exact artifact bytes to a new local file.',
    inputSchema: artifactGetInputJsonSchema,
  },
  ...['run.python', 'data.query', 'artifact.create'].map((name) => ({
    name,
    description:
      'Execute a bounded task with an explicit credit maximum and idempotency key; matching retries recover the existing run.',
    inputSchema: runSubmitInputJsonSchema,
  })),
  ...['run.get', 'run.wait', 'run.cancel'].map((name) => ({
    name,
    description:
      'Inspect, wait for, or cancel one durable run. Waiting never resubmits or cancels implicitly.',
    inputSchema: runSelectionInputJsonSchema,
  })),
  {
    name: 'data.list',
    description: 'List tables available in a project, including queryability and source metadata.',
    inputSchema: listDataTablesInputJsonSchema,
  },
  {
    name: 'data.describe',
    description: 'Describe the columns of one queryable table.',
    inputSchema: describeDataTableInputJsonSchema,
  },
  {
    name: 'project.list',
    description: 'List projects visible to the current organization member.',
    inputSchema: listProjectsInputJsonSchema,
  },
] as const satisfies readonly CliSchemaEntry[]

function details(entry: CliSchemaEntry) {
  return {
    command: { name: entry.name, description: entry.description },
    inputSchema: entry.inputSchema,
  }
}

export function runSchemaCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  output: Output
): boolean {
  if (group !== 'schema') return false
  if (args.length > 0) {
    throw new UsageError('Usage: teler schema [data.list|data.describe|project.list]')
  }

  if (action === undefined) {
    const commands = CLI_SCHEMA_REGISTRY.map(({ name, description }) => ({ name, description }))
    if (output.json) emitJson(output, { commands })
    else {
      output.write('Available command schemas:\n')
      for (const command of commands) output.write(`${command.name}\t${command.description}\n`)
    }
    return true
  }

  const entry = CLI_SCHEMA_REGISTRY.find((candidate) => candidate.name === action)
  if (!entry) {
    throw new UsageError('Unknown schema command. Run `teler schema` to list available schemas.')
  }
  const result = details(entry)
  if (output.json) emitJson(output, result)
  else {
    output.write(`Command: ${result.command.name}\n`)
    output.write(`${result.command.description}\n`)
    output.write(`Input JSON Schema:\n${JSON.stringify(result.inputSchema, null, 2)}\n`)
  }
  return true
}
