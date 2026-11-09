import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const org = `org_${suffix}`
const now = '2026-11-09T09:00:00.000Z'
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }

const tableStart = {
  id: `sched_${suffix}`,
  startKind: 'table_update',
  agentId: `agent_${suffix}`,
  organizationId: org,
  startTable: { kind: 'document', id: 'doctbl_x', label: null, gone: null },
  startAgent: null,
  deliveryMethod: 'chat',
  isPaused: false,
  lastRunAt: null,
  lastRunStatus: null,
  createdAt: now,
  updatedAt: now,
}
const deleted = { ...tableStart, startTable: { ...tableStart.startTable, gone: 'deleted' } }
const replaced = {
  ...tableStart,
  id: `sched_${'02m2k72d22fqe8ww472ycs3px3'}`,
  startTable: { ...tableStart.startTable, gone: 'replaced' },
}

const DELETED_WORDS = "won't run: its table was deleted. Choose a table again"
const REPLACED_WORDS = 'waiting for the replaced file to finish loading'

async function cli(argv: string[], body: unknown) {
  let stdout = ''
  const exitCode = await main(argv, {
    env,
    fetch: async () => Response.json(body),
    writeOut: (text) => (stdout += text),
    writeErr: () => undefined,
  })
  return { exitCode, stdout }
}

describe('table starts whose table is gone', () => {
  it('lists a deleted table and a replaced file in words, and keeps gone in --json', async () => {
    const list = { schedules: [], eventStarts: [deleted, replaced] }
    const listed = await cli(['schedule', 'list', '--org', org], list)
    expect(listed).toMatchObject({
      exitCode: 0,
      stdout:
        `${deleted.id}\ttable_update\t${DELETED_WORDS}\n` +
        `${replaced.id}\ttable_update\t${REPLACED_WORDS}\n`,
    })

    const json = await cli(['schedule', 'list', '--org', org, '--json'], list)
    const starts = JSON.parse(json.stdout).eventStarts as Array<{ startTable: { gone: unknown } }>
    expect(starts.map((start) => start.startTable.gone)).toEqual(['deleted', 'replaced'])
  })

  it('reads an older server without the key, and a table that exists, as before', async () => {
    const { gone: _dropped, ...olderTable } = tableStart.startTable
    const older = await cli(['schedule', 'list', '--org', org], {
      schedules: [],
      eventStarts: [{ ...tableStart, startTable: olderTable }],
    })
    expect(older.stdout).toBe(`${tableStart.id}\ttable_update\tstarts when its table updates\n`)
    const json = await cli(['schedule', 'list', '--org', org, '--json'], {
      schedules: [],
      eventStarts: [{ ...tableStart, startTable: olderTable }],
    })
    expect(JSON.parse(json.stdout).eventStarts[0].startTable).toEqual(olderTable)

    const present = await cli(['schedule', 'list', '--org', org], {
      schedules: [],
      eventStarts: [tableStart],
    })
    expect(present.stdout).toBe(`${tableStart.id}\ttable_update\tstarts when its table updates\n`)
  })

  it('keeps a reason a newer server adds, and says it cannot word it', async () => {
    const later = { ...tableStart, startTable: { ...tableStart.startTable, gone: 'archived' } }
    const listed = await cli(['schedule', 'list', '--org', org], {
      schedules: [],
      eventStarts: [later],
    })
    expect(listed).toMatchObject({
      exitCode: 0,
      stdout: `${later.id}\ttable_update\tits table is unavailable (update teler to see more)\n`,
    })
    const json = await cli(['schedule', 'list', '--org', org, '--json'], {
      schedules: [],
      eventStarts: [later],
    })
    expect(JSON.parse(json.stdout).eventStarts[0].startTable.gone).toBe('archived')
  })

  it('says why after an update, a pause, a resume or an approval', async () => {
    for (const [argv, verb] of [
      [['schedule', 'update', deleted.id, '--delivery', 'email'], 'Updated'],
      [['schedule', 'resume', deleted.id], 'Updated'],
      [['schedule', 'approve', deleted.id], 'Approved'],
    ] as const) {
      const result = await cli([...argv], deleted)
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: `${verb} ${deleted.id}: ${DELETED_WORDS}\n`,
      })
    }
    const paused = await cli(['schedule', 'pause', deleted.id], { ...deleted, isPaused: true })
    expect(paused.stdout).toBe(`Updated ${deleted.id}: paused · ${DELETED_WORDS}\n`)
    const pausedList = await cli(['schedule', 'list', '--org', org], {
      schedules: [],
      eventStarts: [{ ...replaced, isPaused: true }],
    })
    expect(pausedList.stdout).toBe(`${replaced.id}\ttable_update\tpaused · ${REPLACED_WORDS}\n`)
  })
})
