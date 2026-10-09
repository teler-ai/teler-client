import { describe, expect, it } from 'bun:test'
import { readSse } from '../src/sse'

function streamChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('readSse', () => {
  it('parses CRLF event boundaries split across network chunks', async () => {
    const events = []
    for await (const event of readSse(
      streamChunks([
        'data: {"type":"text-delta","delta":"hello"}\r',
        '\n\r',
        '\ndata: [DONE]\r\n\r\n',
      ])
    )) {
      events.push(event)
    }

    expect(events).toEqual([
      { kind: 'data', value: { type: 'text-delta', delta: 'hello' } },
      { kind: 'done' },
    ])
  })

  it('joins multiline data fields before parsing JSON', async () => {
    const events = []
    for await (const event of readSse(streamChunks(['data: {"value":\n', 'data: 1}\n\n']))) {
      events.push(event)
    }

    expect(events).toEqual([{ kind: 'data', value: { value: 1 } }])
  })

  it('retains event names and cursors for reconnectable streams', async () => {
    const events = []
    for await (const event of readSse(
      streamChunks(['event: content\nid: 42\ndata: {"done":false}\n\n'])
    )) {
      events.push(event)
    }

    expect(events).toEqual([{ kind: 'data', event: 'content', id: '42', value: { done: false } }])
  })
})
