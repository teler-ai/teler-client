import { takeOption } from './command-args'
import { ApiError } from './errors'

/** `--approve a,b`: `ask` capabilities approved for unattended runs. */
export function takeApprovedCapabilities(args: string[]): string[] | undefined {
  const value = takeOption(args, '--approve')
  if (value === undefined) return undefined
  return value
    .split(',')
    .map((capability) => capability.trim())
    .filter(Boolean)
}

export interface ApprovalGuidance {
  /** The command to re-run with `--approve`. */
  command: string
  /** Refusal code and lead sentence when capabilities need approval. */
  required: readonly [code: string, lead: string]
  /** Refusal code and lead sentence when policy denies capabilities. */
  denied?: readonly [code: string, lead: string]
}

/** Name what to approve, or what policy denies, instead of a bare status code. */
export async function withApprovalGuidance<T>(
  guidance: ApprovalGuidance,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof ApiError) || !error.capabilities?.length) throw error
    const capabilities = error.capabilities.join(',')
    const { denied, required } = guidance
    const message =
      error.code === required[0]
        ? `${required[1]}: ${capabilities}. ` +
          `Re-run ${guidance.command} with --approve ${capabilities}.`
        : denied && error.code === denied[0]
          ? `${denied[1]}: ${capabilities}.`
          : null
    if (!message) throw error
    throw new ApiError(message, error.status, error.code, undefined, error.capabilities)
  }
}
