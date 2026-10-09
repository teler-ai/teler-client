import { CommandError, UsageError } from './errors'

export function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name)
  if (index < 0) return false
  args.splice(index, 1)
  return true
}

export function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new UsageError(`${name} requires a value`)
  args.splice(index, 2)
  return value
}

export function assertNoFlags(args: string[]): void {
  if (args.some((arg) => arg.startsWith('-'))) throw new UsageError('Unknown option')
}

export function parseLimit(raw: string | undefined, fallback: number, maximum: number): number {
  const limit = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new UsageError(`--limit must be an integer from 1 to ${maximum}`)
  }
  return limit
}

export async function withTimeout<T>(
  rawSeconds: string | undefined,
  operation: (signal?: AbortSignal) => Promise<T>
): Promise<T> {
  if (rawSeconds === undefined) return await operation()
  const seconds = Number(rawSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) {
    throw new UsageError('--timeout must be greater than 0 and at most 3600 seconds')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), seconds * 1000)
  try {
    return await operation(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw new CommandError('TIMEOUT', 'Teler operation timed out')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
