/**
 * Why a scheduled run was skipped or did not finish, in words a person can act on: the one source
 * of those sentences for `teler schedule history` and `teler schedule file runs`. Plain output
 * shows a sentence, never the code or an HTTP status; `--json` keeps the codes and adds the
 * sentence as `reasonText`.
 */
export const SCHEDULE_RUN_REASON_TEXT = {
  credit_check_unavailable:
    "Teler couldn't check your credits, so this run was skipped. We're on it.",
  no_credits:
    'Your organization ran out of credits, so this run was skipped. Add credits to run it.',
  spend_limit_reached: 'This schedule reached its spending limit, so this run was skipped.',
  spend_needs_approval:
    "This schedule's spending needs your approval again, so this run was skipped.",
  plan_inactive: "Your plan isn't active, so this run was skipped. Renew it to run schedules.",
  no_free_automatic_start: "Your plan's automatic starts are all in use: pause one to run this.",
  needs_reapproval: 'A change affected what this Agent may do: re-approve its schedule to run it.',
  needs_run: 'This Agent needs a Run before its schedule can start: open it to see what it needs.',
  schedule_paused: 'This schedule was paused, so this run was skipped.',
  owner_paused: 'Your access is paused, so this run was skipped.',
  owner_left: "This schedule's owner is no longer in the organization, so this run was skipped.",
  agent_unavailable:
    "This Agent can't run right now (it's turned off, deleted or not ready), so this run was skipped.",
  project_changed: "This schedule's project moved or is gone, so this run was skipped.",
  data_unavailable: 'The data this schedule reads is gone or changed, so this run was skipped.',
  not_allowed_here: "This project's access rules don't allow this run, so it was skipped.",
  held_by_admin: 'An admin stopped this schedule, so this run was skipped.',
  model_provider_blocked: "Your organization's AI provider is stopped, so this run was skipped.",
  busy: 'The previous run was still going, so this one was skipped. The next one runs as usual.',
  code_flagged: "Teler's safety check refused this File's code, so this run was skipped.",
  code_check_unavailable:
    "Teler couldn't check this File's code yet, so this run was skipped. The next one checks again.",
  alert_loop: 'The alert was raised by a run this start began, so it was skipped.',
  chain_depth_limit: 'Too many Agents started each other in a row, so this run was skipped.',
  alert_daily_limit: 'This start reached its daily limit of alert runs, so this run was skipped.',
  table_daily_limit: 'This start reached its daily limit of table runs, so this run was skipped.',
  run_failed: "The run didn't finish.",
  other: 'This run was skipped.',
} as const satisfies Readonly<Record<string, string>>

export type ScheduleRunReason = keyof typeof SCHEDULE_RUN_REASON_TEXT

/**
 * The code an older server records on a row (and still sends, without a `reason`), to the
 * reason it means. A code not listed reads as the generic sentence.
 */
const REASON_BY_CODE: Readonly<Record<string, ScheduleRunReason>> = {
  billing_unavailable: 'credit_check_unavailable',
  no_credits: 'no_credits',
  NO_CREDITS: 'no_credits',
  SPEND_CAP_REACHED: 'spend_limit_reached',
  ORG_CAP_REACHED: 'spend_limit_reached',
  SPEND_NOT_APPROVED: 'spend_needs_approval',
  SPEND_EXPIRED: 'spend_needs_approval',
  TERMS_CHANGED: 'spend_needs_approval',
  FUNDING_CHANGED: 'spend_needs_approval',
  plan_inactive: 'plan_inactive',
  automatic_start_limit: 'no_free_automatic_start',
  plan_no_schedules: 'no_free_automatic_start',
  agent_permissions_changed: 'needs_reapproval',
  authorization_revoked: 'needs_reapproval',
  authority_drift: 'needs_run',
  source_bindings_required: 'needs_run',
  schedule_paused: 'schedule_paused',
  access_paused: 'owner_paused',
  not_org_member: 'owner_left',
  // Two reasons an older server recorded as sentences rather than codes.
  'User is no longer a member of the org': 'owner_left',
  'Agent no longer exists': 'agent_unavailable',
  agent_not_found: 'agent_unavailable',
  agent_disabled: 'agent_unavailable',
  agent_not_ready: 'agent_unavailable',
  invalid_request: 'agent_unavailable',
  project_not_found: 'project_changed',
  project_changed: 'project_changed',
  data_scope_unavailable: 'data_unavailable',
  table_unavailable: 'data_unavailable',
  ACCESS_LOST: 'data_unavailable',
  TARGET_CHANGED: 'data_unavailable',
  TARGET_UNAVAILABLE: 'data_unavailable',
  UPLOAD_MISSING: 'data_unavailable',
  UPLOAD_COLUMNS_CHANGED: 'data_unavailable',
  UPLOAD_TOO_LARGE: 'data_unavailable',
  GOVERNANCE_DENIED: 'not_allowed_here',
  ADMIN_HOLD: 'held_by_admin',
  model_provider_blocked: 'model_provider_blocked',
  member_cap: 'busy',
  idempotency_conflict: 'busy',
  PREVIOUS_RUN_ACTIVE: 'busy',
  STALE: 'busy',
  TARGET_BUSY: 'busy',
  UPLOAD_REPLACING: 'busy',
  CODE_FLAGGED: 'code_flagged',
  CODE_CHECK_UNAVAILABLE: 'code_check_unavailable',
  alert_loop: 'alert_loop',
  chain_depth_limit: 'chain_depth_limit',
  alert_daily_limit: 'alert_daily_limit',
  table_daily_limit: 'table_daily_limit',
}

/** A table's own entry for a key, never one inherited from `Object.prototype`. */
function own<T>(table: Readonly<Record<string, T>>, key: string | null | undefined): T | undefined {
  return key != null && Object.hasOwn(table, key) ? table[key] : undefined
}

function isReason(value: string | null | undefined): value is ScheduleRunReason {
  return own(SCHEDULE_RUN_REASON_TEXT, value) !== undefined
}

/**
 * The sentence for a skipped or failed row: the server's `reason`, else (an older server) what
 * its recorded code means, else the generic sentence for its status. A started row has none.
 */
export function scheduleRunReasonText(
  status: 'success' | 'failed' | 'skipped',
  reason: string | null | undefined,
  code: string | null | undefined
): string | null {
  if (status === 'success') return null
  const key = isReason(reason) ? reason : own(REASON_BY_CODE, code)
  return SCHEDULE_RUN_REASON_TEXT[key ?? (status === 'failed' ? 'run_failed' : 'other')]
}

/** Why a started Agent run did not finish, as the end of "It started but didn't finish: …". */
const AGENT_RUN_REASON_WORDS: Readonly<Record<string, string>> = {
  needs_capability: "it needed a capability its Agent doesn't have",
  needs_input: 'it needed an answer from you',
  execution_timeout: 'it reached its time limit',
  memory_limit: 'it needed more compute than is available',
  disk_limit: 'it needed more storage than is available',
  gpu_needed: 'it needed a GPU',
  analysis_limit_reached: 'it reached its analysis limit',
  tool_execution_failed: "a data step couldn't finish",
  runner_failure: "the service running it couldn't finish it",
  exploration_backend_unavailable: 'the data workspace was unavailable',
  source_authority_revoked: 'its access to the data changed',
  artifact_delivery_failed: "one of its outputs couldn't be saved",
  membership_revoked: 'your access to the organization changed',
  user_cancelled: 'it was cancelled',
}

const UNFINISHED = new Set(['limited', 'failed', 'cancelled'])

/**
 * The sentence for a row whose Agent run started but did not finish: `agentRunOutcome` when the
 * server sends it, else the run's status (an older server). A run still going, or one that
 * succeeded, has none; a reason this version does not know adds no detail.
 */
export function agentRunOutcomeText(run: {
  agentRunOutcome: string | null
  agentRunReason: string | null
  agentRunStatus: string | null
}): string | null {
  const outcome =
    run.agentRunOutcome ??
    (run.agentRunStatus === 'failed' || run.agentRunStatus === 'cancelled'
      ? run.agentRunStatus
      : null)
  if (outcome === null || !UNFINISHED.has(outcome)) return null
  const detail =
    own(AGENT_RUN_REASON_WORDS, run.agentRunReason) ??
    (outcome === 'cancelled' ? AGENT_RUN_REASON_WORDS.user_cancelled : undefined)
  return detail ? `It started but didn't finish: ${detail}.` : "It started but didn't finish."
}
