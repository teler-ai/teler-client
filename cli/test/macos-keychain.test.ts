import { describe, expect, it } from 'bun:test'
import { upsertMacOSKeychainItem } from '../src/macos-keychain'

describe('macOS Keychain writes', () => {
  it('updates the winning item when concurrent creation reports a duplicate', () => {
    let findCalls = 0
    const modifiedItems: number[] = []
    const releasedItems: number[] = []

    upsertMacOSKeychainItem({
      findItem: () => {
        findCalls += 1
        return findCalls === 1 ? { status: -25300, item: null } : { status: 0, item: 42 }
      },
      addItem: () => -25299,
      modifyItem: (item) => {
        modifiedItems.push(item)
        return 0
      },
      releaseItem: (item) => releasedItems.push(item),
    })

    expect(findCalls).toBe(2)
    expect(modifiedItems).toEqual([42])
    expect(releasedItems).toEqual([42])
  })
})
