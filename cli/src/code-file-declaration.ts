import type { TelerApiClient } from './api'
import { takeOption, takeOptions } from './command-args'
import {
  alertRuleSchema,
  bindingsResponseSchema,
  codeFileIdSchema,
  declarationSchema,
  jobNameSchema,
  projectIdSchema,
  runDeclarationSchema,
  type Declaration,
} from './code-file-contract'
import { parseControlInput, parseControlJson } from './control-args'
import { ApiError, CommandError, UsageError } from './errors'

type InputSpec =
  { kind: 'table'; name: string; ref: string } | { kind: 'file'; name: string; fileId: string }

/**
 * `--input`, `--output`, `--params`, `--project` and `--alert-rule`: what a run or schedule of
 * code names.
 */
export interface DeclarationFlags {
  inputs: InputSpec[]
  outputs: string[]
  parameters?: Declaration['parameters']
  projectId?: string
  alertRule?: string
}

const parametersSchema = declarationSchema.shape.parameters
const JSON_OUTPUT = { contractVersion: 1, kind: 'json', schema: { mode: 'open' } } as const

/** `<name>=<table-ref>` (a ref from `teler data list`) or `<name>=file:<file-id>`. */
function parseInput(spec: string): InputSpec {
  const separator = spec.indexOf('=')
  const name = spec.slice(0, separator)
  const value = spec.slice(separator + 1)
  if (separator < 1 || !value || !jobNameSchema.safeParse(name).success)
    throw new UsageError('--input must be <name>=<table-ref> or <name>=file:<file-id>')
  if (!value.startsWith('file:')) return { kind: 'table', name, ref: value }
  return {
    kind: 'file',
    name,
    fileId: parseControlInput(codeFileIdSchema, value.slice(5), '--input file ID'),
  }
}

export function takeDeclarationFlags(args: string[]): DeclarationFlags {
  const inputs = takeOptions(args, '--input').map(parseInput)
  const outputs = takeOptions(args, '--output').map((slot) =>
    parseControlInput(jobNameSchema, slot, '--output slot')
  )
  const rawParameters = takeOption(args, '--params')
  const projectId = takeOption(args, '--project')
  const alertRule = takeOption(args, '--alert-rule')
  const parameters =
    rawParameters === undefined
      ? undefined
      : parseControlInput(
          parametersSchema,
          parseControlJson(rawParameters, '--params'),
          '--params; it must be a JSON object'
        )
  return {
    inputs,
    outputs,
    parameters,
    projectId:
      projectId === undefined
        ? undefined
        : parseControlInput(projectIdSchema, projectId, 'project ID'),
    alertRule:
      alertRule === undefined
        ? undefined
        : parseControlInput(
            alertRuleSchema,
            alertRule,
            '--alert-rule; use one line of up to 280 characters'
          ),
  }
}

/** Resolves inputs to the bindings a File's contract, a run and a schedule name, in order. */
export async function resolveBindings(
  client: TelerApiClient,
  organizationId: string,
  flags: Pick<DeclarationFlags, 'inputs' | 'projectId'>
) {
  if (flags.inputs.length === 0) return []
  const resolved = await client.json('/api/schedule/files/inputs', bindingsResponseSchema, {
    method: 'POST',
    body: JSON.stringify({
      organizationId,
      projectId: flags.projectId ?? null,
      inputs: flags.inputs,
    }),
  })
  return resolved.bindings
}

/** The member's own last declaration of the File's current version, and whether it may run. */
async function readDeclaration(
  client: TelerApiClient,
  organizationId: string,
  fileId: string,
  projectId: string | undefined
) {
  const query = new URLSearchParams({ organizationId, fileId })
  if (projectId) query.set('projectId', projectId)
  return await client.json(`/api/schedule/files/run-declaration?${query}`, runDeclarationSchema)
}

/**
 * The declaration the flags give, or, with none, the one of the member's own last run of the
 * File's current version (what `teler files run` recorded). `use` names which may run it.
 */
export async function declarationFor(
  client: TelerApiClient,
  organizationId: string,
  fileId: string,
  flags: DeclarationFlags,
  use: 'runNow' | 'schedule'
): Promise<Declaration> {
  const alertRule = flags.alertRule === undefined ? {} : { alertRule: flags.alertRule }
  if (flags.outputs.length > 0) {
    if (flags.outputs.length > 1 && !flags.outputs.includes('result'))
      throw new UsageError('With several --output slots, one must be named result')
    if (flags.alertRule === undefined) {
      // Outputs named again would otherwise drop the rule the File's runs alert by.
      const kept = (await readDeclaration(client, organizationId, fileId, flags.projectId))
        .declaration?.alertRule
      if (kept !== undefined)
        throw new CommandError(
          'ALERT_RULE_REQUIRED',
          `This File alerts when ${kept}; naming its outputs with --output would drop that rule`,
          'Pass the rule with --alert-rule "<rule>", or leave out --output to repeat your last run.'
        )
    }
    return {
      projectId: flags.projectId ?? null,
      parameters: flags.parameters ?? {},
      bindings: await resolveBindings(client, organizationId, flags),
      dependencies: [],
      outputs: flags.outputs.map((slot) => ({ slot, required: true, contract: JSON_OUTPUT })),
      seed: null,
      ...alertRule,
    }
  }
  if (flags.inputs.length > 0 || flags.parameters !== undefined)
    throw new UsageError('--input and --params need --output <slot>')
  const read = await readDeclaration(client, organizationId, fileId, flags.projectId)
  const availability = read[use]
  if (!availability.available) {
    throw new CommandError(
      availability.reason,
      `This File cannot ${use === 'runNow' ? 'run' : 'be scheduled'} as declared (${availability.reason})`,
      availability.reason === 'NO_OUTPUT_CONTRACT'
        ? 'Name what it writes the first time: pass --output <slot> (and --input, --params).'
        : undefined
    )
  }
  const declaration = declarationSchema.safeParse(read.declaration)
  if (!declaration.success) throw new ApiError('Teler API returned an invalid response', 502)
  return { ...declaration.data, ...alertRule }
}
