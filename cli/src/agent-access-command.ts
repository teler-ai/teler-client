import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { assertNoFlags, takeOption } from './command-args'
import { emitJson, resolveOrganizationId } from './command-output'
import { parseControlInput } from './control-args'
import { ApiError, UsageError } from './errors'

const organizationIdSchema = z.string().regex(/^org_[0-9a-hjkmnp-tv-z]{26}$/)
const policyMetadata = z.object({
  revision: z.number().int().positive(),
  policy: z.object({
    formatVersion: z.literal(1),
    catalogVersion: z.literal(1),
    default: z.string(),
    // Only the count is emitted; policy selectors and untrusted details stay private.
    rules: z.array(z.unknown()).max(256),
  }),
})
const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    organizationId: organizationIdSchema,
    membershipId: z.string().regex(/^member_[0-9a-hjkmnp-tv-z]{26}$/),
    organization: policyMetadata.extend({
      policy: policyMetadata.shape.policy.extend({
        default: z.enum(['permitted', 'approval_required', 'blocked']),
      }),
    }),
    member: policyMetadata.extend({
      policy: policyMetadata.shape.policy.extend({ default: z.enum(['allow', 'ask', 'never']) }),
    }),
  }),
})

function summary(data: z.infer<typeof responseSchema>['data']) {
  const metadata = (value: z.infer<typeof policyMetadata>) => ({
    revision: value.revision,
    default: value.policy.default,
    ruleCount: value.policy.rules.length,
  })
  return {
    organizationId: data.organizationId,
    membershipId: data.membershipId,
    organizationPolicy: metadata(data.organization),
    memberPolicy: metadata(data.member),
  }
}

export async function runAgentAccessCommand(
  client: TelerApiClient,
  output: Output,
  action: string | undefined,
  args: string[]
): Promise<void> {
  if (action !== 'show' && action !== 'set') {
    throw new UsageError('Usage: teler agent-access show|set [--org <id>]')
  }
  const suppliedOrganization = takeOption(args, '--org')
  if (suppliedOrganization)
    parseControlInput(organizationIdSchema, suppliedOrganization, 'organization ID')
  if (action === 'set' && takeOption(args, '--preset') !== 'ask') {
    throw new UsageError('teler agent-access set requires --preset ask')
  }
  assertNoFlags(args)
  if (args.length) throw new UsageError('Unexpected Agent Access arguments')
  const organizationId = parseControlInput(
    organizationIdSchema,
    await resolveOrganizationId(client, suppliedOrganization),
    'organization ID'
  )
  const endpoint = `/api/organization/${organizationId}/agent-access-policy`
  let result = await client.json(endpoint, responseSchema)
  if (result.data.organizationId !== organizationId) {
    throw new ApiError('Teler API returned an invalid response', 502)
  }
  const alreadyAsk =
    result.data.member.policy.default === 'ask' && result.data.member.policy.rules.length === 0
  if (action === 'set' && !alreadyAsk) {
    const membershipId = result.data.membershipId
    result = await client.json(endpoint, responseSchema, {
      method: 'PATCH',
      body: JSON.stringify({
        scope: 'member',
        expectedRevision: result.data.member.revision,
        existingChatOverrides: 'preserve',
        policy: { formatVersion: 1, catalogVersion: 1, default: 'ask', rules: [] },
      }),
    })
    if (
      result.data.organizationId !== organizationId ||
      result.data.membershipId !== membershipId
    ) {
      throw new ApiError('Teler API returned an invalid response', 502)
    }
  }
  const value = summary(result.data)
  if (output.json) emitJson(output, value)
  else
    output.write(
      `Agent Access on ${organizationId}: member ${value.memberPolicy.default}, revision ${value.memberPolicy.revision}, ${value.memberPolicy.ruleCount} rules; organization ${value.organizationPolicy.default}.\n`
    )
}
