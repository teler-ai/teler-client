import { describe, expect, it } from 'bun:test'
import { resolveChatId, resolveTaskId } from '../src/chat-id'

const ID = 'chat_01m2mgs69ge8nvmkdg6924cgg9'

describe('resolveChatId', () => {
  it('accepts IDs and application chat URLs', () => {
    expect(resolveChatId(ID)).toBe(ID)
    expect(resolveChatId(`https://app.teler.ai/org/o/project/p/chat/${ID}`)).toBe(ID)
  })

  it('rejects unrelated URLs without echoing them', () => {
    expect(() => resolveChatId('https://example.test/?token=secret')).toThrow(
      'Expected a Teler chat ID or chat URL'
    )
  })
})

describe('resolveTaskId', () => {
  it('accepts only agent task TypeIDs', () => {
    expect(resolveTaskId('atask_01m2mgs69ge8nvmkdg6924cgg9')).toBe(
      'atask_01m2mgs69ge8nvmkdg6924cgg9'
    )
    expect(() => resolveTaskId('../../api/user/sessions')).toThrow('Expected a Teler agent task ID')
  })
})
