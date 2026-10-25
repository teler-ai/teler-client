/** A member Agent Access policy as the API takes it: a default decision and narrower rules. */
export interface MemberPolicy {
  default: 'allow' | 'ask' | 'never'
  rules: { selector: { category: string } | { capability: string }; decision: string }[]
}

const allow = (capability: string) => ({ selector: { capability }, decision: 'allow' })

/**
 * The presets the app offers a member, written exactly as the app writes them, so the app shows
 * the same preset: Standard asks for web and actions and allows reading data; Ask asks for
 * everything; Read-only allows reading and refuses the rest; Allow everything never asks.
 */
export const MEMBER_PRESETS = {
  standard: {
    default: 'ask',
    rules: [
      { selector: { category: 'web' }, decision: 'ask' },
      ...[
        'connectors.discover',
        'connectors.query',
        'tables.metadata.read',
        'tables.rows.read',
        'files.metadata.read',
        'files.content.read',
        'decisions.run',
      ].map(allow),
    ],
  },
  ask: { default: 'ask', rules: [] },
  'read-only': {
    default: 'never',
    rules: [
      'web.search',
      'web.fetch',
      'connectors.discover',
      'connectors.query',
      'files.metadata.read',
      'files.content.read',
      'tables.metadata.read',
      'tables.rows.read',
    ].map(allow),
  },
  'allow-everything': { default: 'allow', rules: [] },
} as const satisfies Record<string, MemberPolicy>

export type MemberPreset = keyof typeof MEMBER_PRESETS
export const MEMBER_PRESET_NAMES = Object.keys(MEMBER_PRESETS) as MemberPreset[]

const fingerprint = (policy: { default: string; rules: readonly unknown[] }) =>
  JSON.stringify([policy.default, policy.rules])

/** The preset a policy is, or `custom` when it is none of them. */
export function presetOf(policy: { default: string; rules: readonly unknown[] }): string {
  const found = MEMBER_PRESET_NAMES.find(
    (name) => fingerprint(MEMBER_PRESETS[name]) === fingerprint(policy)
  )
  return found ?? 'custom'
}
