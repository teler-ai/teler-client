/** One `teler` command as `teler schema` describes it. */
export interface CliCommand {
  name: string
  usage: string
  description: string
  /** The command-line flag or argument each input-schema field comes from. */
  flags?: Readonly<Record<string, string>>
  inputSchema?: object
}

export function command(
  name: string,
  usage: string,
  description: string,
  typed: Partial<CliCommand> = {}
): CliCommand {
  return { name, usage: `teler ${usage}`, description, ...typed }
}
