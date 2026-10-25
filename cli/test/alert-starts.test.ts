import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const org = `org_${suffix}`
const agentId = `agent_${suffix}`
const watchedAgent = `agent_${'02m2k72d22fqe8ww472ycs3px3'}`
const watchedFile = `doc_${'03m2k72d22fqe8ww472ycs3px3'}`
const now = '2026-10-25T09:00:00.000Z'
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }

const tableStart = {
  id: `sched_${suffix}`,
  startKind: 'table_update',
  agentId,
  organizationId: org,
  startTable: { kind: 'connector', id: 'ctbl_x', label: 'Sales' },
  startAgent: null,
  deliveryMethod: 'chat',
  isPaused: false,
  lastRunAt: null,
  lastRunStatus: null,
  createdAt: now,
  updatedAt: now,
}
const agentAlertStart = {
  ...tableStart,
  id: `sched_${'04m2k72d22fqe8ww472ycs3px3'}`,
  startKind: 'alert_opened',
  startTable: null,
  startAlert: { kind: 'agent', id: watchedAgent, label: 'Stock alerts' },
}
const fileAlertStart = {
  ...agentAlertStart,
  id: `sched_${'05m2k72d22fqe8ww472ycs3px3'}`,
  startAlert: { kind: 'file', id: watchedFile, label: null },
}
const laterStart = {
  ...tableStart,
  id: `sched_${'06m2k72d22fqe8ww472ycs3px3'}`,
  startKind: 'webhook_received',
  startTable: null,
}

async function cli(argv: string[], respond: () => Response) {
  let stdout = ''
  let stderr = ''
  const exitCode = await main(argv, {
    env,
    fetch: async () => respond(),
    writeOut: (text) => (stdout += text),
    writeErr: (text) => (stderr += text),
  })
  return { exitCode, stdout, stderr }
}

describe('alert-opened starts', () => {
  it('lists them in words, naming the Agent or File whose alert starts the run', async () => {
    const listed = await cli(['schedule', 'list', '--org', org], () =>
      Response.json({ schedules: [], eventStarts: [agentAlertStart, fileAlertStart] })
    )
    expect(listed.exitCode).toBe(0)
    expect(listed.stdout).toBe(
      `${agentAlertStart.id}\talert_opened\tstarts when an alert opens on the Agent Stock alerts\n` +
        `${fileAlertStart.id}\talert_opened\tstarts when an alert opens on the File ${watchedFile}\n`
    )

    const json = await cli(['schedule', 'list', '--org', org, '--json'], () =>
      Response.json({ schedules: [], eventStarts: [agentAlertStart] })
    )
    expect(JSON.parse(json.stdout).eventStarts[0].startAlert).toEqual(agentAlertStart.startAlert)
  })

  it('leaves out a start kind this version does not know, and lists the rest', async () => {
    const listed = await cli(['schedule', 'list', '--org', org], () =>
      Response.json({ schedules: [], eventStarts: [laterStart, tableStart] })
    )
    expect(listed).toMatchObject({
      exitCode: 0,
      stdout: `${tableStart.id}\ttable_update\tstarts when its table updates\n`,
    })
    const json = await cli(['schedule', 'list', '--org', org, '--json'], () =>
      Response.json({ schedules: [], eventStarts: [laterStart, tableStart] })
    )
    expect(JSON.parse(json.stdout).eventStarts.map((start: { id: string }) => start.id)).toEqual([
      tableStart.id,
    ])
  })

  it('still refuses a start of a known kind that is malformed', async () => {
    const { startAlert: _dropped, ...withoutSubject } = agentAlertStart
    const listed = await cli(['schedule', 'list', '--org', org], () =>
      Response.json({ schedules: [], eventStarts: [{ ...withoutSubject, startAlert: 'x' }] })
    )
    expect(listed.exitCode).toBe(1)
  })

  it('updates, pauses, resumes and approves one', async () => {
    const id = agentAlertStart.id
    for (const [argv, verb] of [
      [['schedule', 'update', id, '--delivery', 'email'], 'Updated'],
      [['schedule', 'pause', id], 'Updated'],
      [['schedule', 'resume', id], 'Updated'],
      [['schedule', 'approve', id], 'Approved'],
    ] as const) {
      const result = await cli([...argv], () => Response.json(agentAlertStart))
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: `${verb} ${id}: starts when an alert opens on the Agent Stock alerts\n`,
      })
    }
    const paused = await cli(['schedule', 'pause', id], () =>
      Response.json({ ...fileAlertStart, isPaused: true })
    )
    expect(paused.stdout).toBe(`Updated ${fileAlertStart.id}: paused\n`)
  })

  it('reports a change to a start of a kind it does not know instead of failing after it', async () => {
    const result = await cli(['schedule', 'pause', laterStart.id], () =>
      Response.json({ ...laterStart, isPaused: true })
    )
    expect(result).toMatchObject({ exitCode: 0, stdout: `Updated ${laterStart.id}: paused\n` })
    const resumed = await cli(['schedule', 'resume', laterStart.id], () =>
      Response.json(laterStart)
    )
    expect(resumed.stdout).toBe(
      `Updated ${laterStart.id}: starts on webhook_received (update teler to see more)\n`
    )
  })
})
