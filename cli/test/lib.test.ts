import { expect, test } from 'bun:test'
import * as library from '../src/lib'

// Programs that drive Teler like the CLI does (for example evaluation harnesses)
// send messages, watch tasks and upload files through the library entry.
test('the library entry exposes the client, chat, task and upload operations', () => {
  for (const name of [
    'TelerApiClient',
    'sendMessage',
    'watchTask',
    'uploadLocalFile',
    'getUploadStatus',
    'abortableDelay',
  ] as const)
    expect(typeof library[name]).toBe('function')
})
