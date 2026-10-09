import type { NotificationEvent, NotificationKind } from './types'

interface Pending {
  items: NotificationEvent[]
  quiet: NodeJS.Timeout | null
  deadline: NodeJS.Timeout | null
}

/**
 * Groups events per kind: a notification goes out once a kind has been quiet
 * for its window, or after the maximum wait while events keep coming.
 */
export class NotificationBatcher {
  private readonly pending = new Map<NotificationKind, Pending>()

  constructor(
    private readonly quietMs: Record<NotificationKind, number>,
    private readonly maxWaitMs: number,
    private readonly deliver: (kind: NotificationKind, items: NotificationEvent[]) => void
  ) {}

  add(kind: NotificationKind, item: NotificationEvent): void {
    const batch = this.pending.get(kind) ?? { items: [], quiet: null, deadline: null }
    this.pending.set(kind, batch)
    batch.items.push(item)
    if (batch.quiet) clearTimeout(batch.quiet)
    batch.quiet = setTimeout(() => this.flush(kind), this.quietMs[kind])
    batch.deadline ??= setTimeout(() => this.flush(kind), this.maxWaitMs)
  }

  /** Drops everything not yet delivered. */
  clear(): void {
    for (const kind of [...this.pending.keys()]) this.reset(kind)
  }

  private flush(kind: NotificationKind): void {
    const items = this.pending.get(kind)?.items ?? []
    this.reset(kind)
    if (items.length > 0) this.deliver(kind, items)
  }

  private reset(kind: NotificationKind): void {
    const batch = this.pending.get(kind)
    if (batch?.quiet) clearTimeout(batch.quiet)
    if (batch?.deadline) clearTimeout(batch.deadline)
    this.pending.delete(kind)
  }
}
