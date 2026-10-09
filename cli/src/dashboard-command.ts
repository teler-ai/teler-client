import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import { emitJson, resolveOrganizationId } from './command-output'
import { parseControlInput, parseControlJson } from './control-args'
import {
  addDashboardWidgetSchema,
  createDashboardSchema,
  dashboardIdSchema,
  dashboardMutationResponseSchema,
  dashboardRefreshApprovalSchema,
  refreshIntervalSchema,
  widgetMutationResponseSchema,
} from './dashboard-contract'
import { takeApprovedCapabilities } from './capability-approval'
import { UsageError } from './errors'

export async function runDashboardCommand(
  client: TelerApiClient,
  output: Output,
  action: string | undefined,
  args: string[]
): Promise<void> {
  if (action === 'create') {
    const input = parseControlInput(
      createDashboardSchema,
      {
        organizationId: takeOption(args, '--org'),
        projectId: takeOption(args, '--project'),
        name: takeOption(args, '--name'),
        description: takeOption(args, '--description'),
        visibility: takeOption(args, '--visibility'),
        refreshInterval: takeOption(args, '--refresh-interval'),
      },
      'dashboard create options'
    )
    assertNoFlags(args)
    if (args.length) throw new UsageError('Usage: teler dashboard create --name <name> [options]')
    const organizationId = await resolveOrganizationId(client, input.organizationId)
    const result = await client.json('/api/dashboard', dashboardMutationResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ ...input, organizationId }),
    })
    if (output.json) emitJson(output, result)
    else output.write(`Created ${result.dashboardId}: ${result.name}\n`)
    return
  }
  if (action === 'add-widget') {
    const input = parseControlInput(
      addDashboardWidgetSchema,
      {
        artifactId: takeOption(args, '--artifact'),
        position: parseControlJson(takeOption(args, '--position'), '--position'),
        idempotencyKey: takeOption(args, '--idempotency-key'),
      },
      'dashboard widget options'
    )
    assertNoFlags(args)
    if (args.length !== 1) throw new UsageError('Usage: teler dashboard add-widget <id> [options]')
    const id = parseControlInput(dashboardIdSchema, args[0], 'dashboard ID')
    const result = await client.json(`/api/dashboard/${id}/widget`, widgetMutationResponseSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    if (output.json) emitJson(output, result)
    else output.write(`Added ${result.widgetId} to ${result.dashboardId}\n`)
    return
  }
  if (action === 'update') {
    const input = parseControlInput(
      z.object({ refreshInterval: refreshIntervalSchema }),
      {
        refreshInterval: takeOption(args, '--refresh-interval'),
      },
      'dashboard interval; use --refresh-interval 1m|5m|15m|30m|1h|4h|1d'
    )
    assertNoFlags(args)
    if (args.length !== 1)
      throw new UsageError('Usage: teler dashboard update <id> --refresh-interval <interval>')
    const id = parseControlInput(dashboardIdSchema, args[0], 'dashboard ID')
    const result = await client.json(`/api/dashboard/${id}`, dashboardMutationResponseSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    if (output.json) emitJson(output, result)
    else output.write(`Updated ${result.dashboardId}: refresh every ${result.refreshInterval}\n`)
    return
  }
  if (action === 'archive') {
    const confirmed = takeFlag(args, '--yes')
    assertNoFlags(args)
    if (!confirmed) throw new UsageError('Dashboard archive requires --yes')
    if (args.length !== 1) throw new UsageError('Usage: teler dashboard archive <id> --yes')
    const id = parseControlInput(dashboardIdSchema, args[0], 'dashboard ID')
    await client.request(`/api/dashboard/${id}`, { method: 'DELETE' })
    if (output.json) emitJson(output, { archived: true, dashboardId: id })
    else output.write(`Archived ${id}\n`)
    return
  }
  if (action === 'approve-refresh') {
    const approved = takeApprovedCapabilities(args)
    assertNoFlags(args)
    if (args.length !== 1) {
      throw new UsageError(
        'Usage: teler dashboard approve-refresh <id> [--approve <capability,...>]'
      )
    }
    const id = parseControlInput(dashboardIdSchema, args[0], 'dashboard ID')
    const result = await client.json(
      `/api/dashboard/${id}/approve-refresh`,
      dashboardRefreshApprovalSchema,
      { method: 'POST', body: JSON.stringify({ approvedCapabilities: approved ?? [] }) }
    )
    if (output.json) emitJson(output, result)
    else {
      output.write(`Approved refreshes of ${result.dashboardId}\n`)
      if (result.notApproved.length > 0) {
        const left = result.notApproved.join(',')
        output.write(
          `Not approved, so refreshes cannot use them: ${left}. ` +
            `Re-run with --approve ${left} to allow them.\n`
        )
      }
    }
    return
  }
  throw new UsageError(
    'Unknown dashboard command. Use list, get, create, add-widget, update, approve-refresh or archive.'
  )
}
