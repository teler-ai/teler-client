export type SseEvent =
  { kind: 'data'; value: unknown; event?: string; id?: string } | { kind: 'done' }

export async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const parse = (frame: string): SseEvent | null => {
    const lines = frame.split(/\r?\n/)
    const payload = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!payload) return null
    if (payload === '[DONE]') return { kind: 'done' }
    try {
      const event = lines
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trimStart()
      const id = lines
        .find((line) => line.startsWith('id:'))
        ?.slice(3)
        .trimStart()
      return {
        kind: 'data',
        value: JSON.parse(payload) as unknown,
        ...(event ? { event } : {}),
        ...(id ? { id } : {}),
      }
    } catch {
      return null
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(buffer)
      if (!boundary || boundary.index === undefined) break
      const event = parse(buffer.slice(0, boundary.index))
      buffer = buffer.slice(boundary.index + boundary[0].length)
      if (event) yield event
    }
    if (done) break
    if (buffer.length > 1024 * 1024) throw new Error('Teler stream exceeded its safety limit')
  }
  const trailing = parse(buffer)
  if (trailing) yield trailing
}
