import { ApiError } from '../errors'
import type { LinkApi } from './api'
import type { LinkUpFrame } from './protocol'

/** Text is batched for this long; tool calls, usage and the end go out at once. */
const TEXT_BATCH_MS = 80

/**
 * One turn's frames to Teler, numbered from `firstSeq` and sent strictly in order. A failed
 * post is retried; Teler saying the turn is gone stops it, and a lost pairing stops the helper.
 */
export class TurnOutbox {
  private seq: number
  private readonly queue: Array<{ seq: number } & LinkUpFrame> = []
  private flushing: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(
    private readonly api: LinkApi,
    private readonly secret: string,
    private readonly taskId: string,
    firstSeq: number,
    private readonly events: { gone(): void; unauthorized(error: ApiError): void }
  ) {
    this.seq = firstSeq
  }

  emit(frame: LinkUpFrame): void {
    if (this.closed) return
    this.queue.push({ seq: this.seq++, ...frame })
    if (frame.kind === 'text.delta') {
      this.timer ??= setTimeout(() => {
        this.timer = undefined
        void this.flush()
      }, TEXT_BATCH_MS)
      return
    }
    void this.flush()
  }

  /** Resolves once everything emitted so far was accepted (or the turn is gone). */
  async drain(): Promise<void> {
    while (this.queue.length > 0 && !this.closed) await this.flush()
  }

  private flush(): Promise<void> {
    this.flushing ??= this.send().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  private async send(): Promise<void> {
    let delay = 500
    while (this.queue.length > 0 && !this.closed) {
      const batch = this.queue.slice(0, 200)
      try {
        await this.api.postFrames(
          this.secret,
          batch.map((frame) => ({ taskId: this.taskId, ...frame }))
        )
        this.queue.splice(0, batch.length)
        delay = 500
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          this.closed = true
          this.queue.length = 0
          this.events.gone()
          return
        }
        if (error instanceof ApiError && error.status === 401) {
          this.closed = true
          this.events.unauthorized(error)
          return
        }
        await Bun.sleep(delay)
        delay = Math.min(delay * 2, 10_000)
      }
    }
  }
}
