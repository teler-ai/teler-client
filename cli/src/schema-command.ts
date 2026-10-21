import type { Output } from './chats'
import { CLI_COMMANDS } from './command-catalog'
import type { CliCommand } from './command-entry'
import { emitJson } from './command-output'
import { UsageError } from './errors'

export type { CliCommand } from './command-entry'
/** Public CLI commands an agent can discover before it invokes one. */
export const CLI_SCHEMA_REGISTRY = CLI_COMMANDS

function details(entry: CliCommand) {
  return {
    command: { name: entry.name, description: entry.description, usage: entry.usage },
    ...(entry.flags ? { flags: entry.flags } : {}),
    ...(entry.inputSchema ? { inputSchema: entry.inputSchema } : {}),
  }
}

export function runSchemaCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  output: Output
): boolean {
  if (group !== 'schema') return false
  if (args.length > 0) throw new UsageError('Usage: teler schema [command] [--json]')

  if (action === undefined) {
    const commands = CLI_SCHEMA_REGISTRY.map(({ name, description, usage }) => ({
      name,
      description,
      usage,
    }))
    if (output.json) emitJson(output, { commands })
    else {
      output.write('Commands (teler schema <command> shows one):\n')
      for (const command of commands) output.write(`${command.name}\t${command.description}\n`)
    }
    return true
  }

  const entry = CLI_SCHEMA_REGISTRY.find((candidate) => candidate.name === action)
  if (!entry) {
    throw new UsageError('Unknown command. Run `teler schema` to list every command.')
  }
  const result = details(entry)
  if (output.json) emitJson(output, result)
  else {
    output.write(`Command: ${entry.name}\n${entry.description}\nUsage: ${entry.usage}\n`)
    if (result.flags) output.write(`Flags:\n${JSON.stringify(result.flags, null, 2)}\n`)
    if (result.inputSchema)
      output.write(`Input JSON Schema:\n${JSON.stringify(result.inputSchema, null, 2)}\n`)
  }
  return true
}
