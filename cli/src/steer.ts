import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { ApiError } from './errors'

const steerSchema = z.object({
  status: z.enum(['accepted', 'duplicate']),
  steerId: z.string().regex(/^armsg_[0-9a-hjkmnp-tv-z]{26}$/),
})

/**
 * Steer your running turn. The turn reads the text at its next step;
 * `teler chat show` reports where it did, or that the turn ended first.
 */
export async function steerTurn(
  client: TelerApiClient,
  output: Output,
  options: { chatId: string; message: string; signal?: AbortSignal }
): Promise<void> {
  let accepted: z.infer<typeof steerSchema>
  try {
    accepted = await client.json(`/api/chat/${options.chatId}/steer`, steerSchema, {
      method: 'POST',
      signal: options.signal,
      body: JSON.stringify({ text: options.message, idempotencyKey: randomUUID() }),
    })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'STEER_CLOSED') {
      throw new ApiError(
        'No running turn of yours to steer. Send it as a new message with `teler send --chat`.',
        error.status,
        error.code
      )
    }
    throw error
  }
  if (output.json) {
    output.write(
      `${JSON.stringify({ type: 'steer.accepted', data: { chatId: options.chatId, steerId: accepted.steerId } })}\n`
    )
  } else {
    output.write(`Steering ${accepted.steerId} sent to the running turn in ${options.chatId}.\n`)
  }
}
