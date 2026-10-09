import type { ZodType } from 'zod'
import { UsageError } from './errors'

export function parseControlInput<T>(schema: ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new UsageError(`Invalid ${label}`)
  return result.data
}

export function parseControlJson(value: string | undefined, label: string): unknown {
  if (!value) throw new UsageError(`${label} is required`)
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new UsageError(`Invalid ${label}`)
  }
}
