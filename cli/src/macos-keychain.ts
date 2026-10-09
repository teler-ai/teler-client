import { dlopen, toArrayBuffer } from 'bun:ffi'
import type { Pointer } from 'bun:ffi'
import { UsageError } from './errors'
import type { CredentialStore } from './credentials'

const SECURITY_FRAMEWORK = '/System/Library/Frameworks/Security.framework/Security'
const CORE_FOUNDATION_FRAMEWORK =
  '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation'

const ERR_SEC_SUCCESS = 0
const ERR_SEC_DUPLICATE_ITEM = -25299
const ERR_SEC_ITEM_NOT_FOUND = -25300

export interface MacOSKeychainSetOperations<Item> {
  findItem: () => { status: number; item: Item | null }
  addItem: () => number
  modifyItem: (item: Item) => number
  releaseItem: (item: Item) => void
}

function keychainError(): UsageError {
  return new UsageError('macOS Keychain is unavailable')
}

export function upsertMacOSKeychainItem<Item>(operations: MacOSKeychainSetOperations<Item>): void {
  const updateItem = (item: Item) => {
    try {
      if (operations.modifyItem(item) !== ERR_SEC_SUCCESS) throw keychainError()
    } finally {
      operations.releaseItem(item)
    }
  }

  const existing = operations.findItem()
  if (existing.status === ERR_SEC_SUCCESS && existing.item !== null) {
    updateItem(existing.item)
    return
  }
  if (existing.status !== ERR_SEC_ITEM_NOT_FOUND) throw keychainError()

  const addStatus = operations.addItem()
  if (addStatus === ERR_SEC_SUCCESS) return
  if (addStatus !== ERR_SEC_DUPLICATE_ITEM) throw keychainError()

  // Another login may create the same item between find and add. Treating the
  // duplicate as success would leave that login's token stored while this one
  // also reports success, so resolve the winner and apply this write to it.
  const racedItem = operations.findItem()
  if (racedItem.status !== ERR_SEC_SUCCESS || racedItem.item === null) throw keychainError()
  updateItem(racedItem.item)
}

export function createMacOSKeychainStore(service: string): CredentialStore {
  const security = dlopen(SECURITY_FRAMEWORK, {
    SecKeychainAddGenericPassword: {
      args: ['ptr', 'u32', 'ptr', 'u32', 'ptr', 'u32', 'ptr', 'ptr'],
      returns: 'i32',
    },
    SecKeychainFindGenericPassword: {
      args: ['ptr', 'u32', 'ptr', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'],
      returns: 'i32',
    },
    SecKeychainItemDelete: { args: ['ptr'], returns: 'i32' },
    SecKeychainItemFreeContent: { args: ['ptr', 'ptr'], returns: 'i32' },
    SecKeychainItemModifyAttributesAndData: {
      args: ['ptr', 'ptr', 'u32', 'ptr'],
      returns: 'i32',
    },
  })
  const coreFoundation = dlopen(CORE_FOUNDATION_FRAMEWORK, {
    CFRelease: { args: ['ptr'], returns: 'void' },
  })
  const serviceBytes = new TextEncoder().encode(service)

  function pointerFromOutput(value: bigint): Pointer | null {
    return value === 0n ? null : (Number(value) as Pointer)
  }

  function findItem(resourceBytes: Uint8Array): { status: number; item: Pointer | null } {
    const itemOutput = new BigUint64Array(1)
    const status = security.symbols.SecKeychainFindGenericPassword(
      null,
      serviceBytes.byteLength,
      serviceBytes,
      resourceBytes.byteLength,
      resourceBytes,
      null,
      null,
      itemOutput
    )
    return { status, item: pointerFromOutput(itemOutput[0]) }
  }

  return {
    async get(resource) {
      const resourceBytes = new TextEncoder().encode(resource)
      const passwordLength = new Uint32Array(1)
      const passwordOutput = new BigUint64Array(1)
      const status = security.symbols.SecKeychainFindGenericPassword(
        null,
        serviceBytes.byteLength,
        serviceBytes,
        resourceBytes.byteLength,
        resourceBytes,
        passwordLength,
        passwordOutput,
        null
      )
      if (status === ERR_SEC_ITEM_NOT_FOUND) return null
      if (status !== ERR_SEC_SUCCESS || passwordOutput[0] === 0n) throw keychainError()

      const passwordPointer = pointerFromOutput(passwordOutput[0])
      if (passwordPointer === null) throw keychainError()
      try {
        const bytes = new Uint8Array(toArrayBuffer(passwordPointer, 0, passwordLength[0]))
        return new TextDecoder().decode(bytes).trim() || null
      } finally {
        security.symbols.SecKeychainItemFreeContent(null, passwordPointer)
      }
    },

    async set(resource, token) {
      const resourceBytes = new TextEncoder().encode(resource)
      const tokenBytes = new TextEncoder().encode(token)
      upsertMacOSKeychainItem({
        findItem: () => findItem(resourceBytes),
        addItem: () =>
          security.symbols.SecKeychainAddGenericPassword(
            null,
            serviceBytes.byteLength,
            serviceBytes,
            resourceBytes.byteLength,
            resourceBytes,
            tokenBytes.byteLength,
            tokenBytes,
            null
          ),
        modifyItem: (item) =>
          security.symbols.SecKeychainItemModifyAttributesAndData(
            item,
            null,
            tokenBytes.byteLength,
            tokenBytes
          ),
        releaseItem: (item) => coreFoundation.symbols.CFRelease(item),
      })
    },

    async delete(resource) {
      const existing = findItem(new TextEncoder().encode(resource))
      if (existing.status === ERR_SEC_ITEM_NOT_FOUND) return
      if (existing.status !== ERR_SEC_SUCCESS || existing.item === null) throw keychainError()
      try {
        const status = security.symbols.SecKeychainItemDelete(existing.item)
        if (status !== ERR_SEC_SUCCESS) throw keychainError()
      } finally {
        coreFoundation.symbols.CFRelease(existing.item)
      }
    },
  }
}
