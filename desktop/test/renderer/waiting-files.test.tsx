// @vitest-environment happy-dom
import { act, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopResult, SyncedFolder } from '../../src/shared/desktop-api'
import { makeFolder, makeState, makeWaitingFile } from './fake-desktop-api'
import { renderApp } from './render-app'

const NOW = new Date('2026-10-06T09:00:00Z').getTime()
const MINUTE = 60_000

const clock = (at: number) =>
  new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(at)

const row = (name: string) => within(screen.getByRole('heading', { level: 3, name }).closest('li')!)

function waitingFolder(overrides: Partial<SyncedFolder> = {}): SyncedFolder {
  return makeFolder({
    id: 'sales',
    name: 'Sales',
    status: 'pending',
    counts: { synced: 30, pending: 0, waiting: 12, problems: 0, skipped: 0 },
    // Ten seconds past three minutes still reads "in 3 minutes".
    nextRetryAt: NOW + 3 * MINUTE + 10_000,
    waitingFiles: [
      makeWaitingFile({ relativePath: 'a.csv', retryAt: NOW + 3 * MINUTE + 10_000 }),
      makeWaitingFile({ relativePath: 'b.csv', retryAt: NOW + 4 * MINUTE }),
      makeWaitingFile({ relativePath: 'c.csv', retryAt: NOW + 5 * MINUTE, reason: 'NETWORK' }),
    ],
    ...overrides,
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

beforeEach(() => {
  // Only the clock is frozen; timers stay real so the countdown still ticks.
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waiting files', () => {
  it('says how many files wait, when they retry and why, and counts down', async () => {
    await renderApp(makeState({ health: 'syncing', folders: [waitingFolder()] }))
    const sales = row('Sales')
    expect(
      sales.getByText('12 files waiting · next try in 3 minutes · Teler is limiting uploads')
    ).toBeVisible()
    // Waiting is not a problem: the counts and the status stay calm.
    expect(sales.getByText('30 synced')).toBeVisible()
    expect(sales.queryByText(/need attention/)).toBeNull()

    vi.setSystemTime(NOW + 2 * MINUTE + 50_000)
    expect(
      await sales.findByText(/next try in 20 seconds/, undefined, { timeout: 2500 })
    ).toBeVisible()

    vi.setSystemTime(NOW + 4 * MINUTE)
    expect(await sales.findByText(/trying again now/, undefined, { timeout: 2500 })).toBeVisible()
  })

  it('uses a clock time when the next try is an hour or more away', async () => {
    const at = NOW + 90 * MINUTE
    await renderApp(makeState({ folders: [waitingFolder({ nextRetryAt: at, waitingFiles: [] })] }))
    expect(row('Sales').getByText(`12 files waiting · next try at ${clock(at)}`)).toBeVisible()
  })

  it('lists waiting files with friendly reasons, never raw codes', async () => {
    const reasons: [string | null, string][] = [
      ['RATE_LIMITED', 'Teler is limiting uploads'],
      ['NETWORK', "Teler can't be reached"],
      ['UPLOAD_NOT_CONFIGURED', "Teler can't store uploads right now"],
      ['STORAGE_QUOTA_EXCEEDED', 'Your Teler storage is full'],
      ['INGEST_IN_PROGRESS', 'Teler is still processing it'],
      ['SYNC_NOT_READY', 'Teler is still processing it'],
      ['HTTP_503', 'Teler had a problem'],
      ['HTTP_400', 'The upload failed'],
      ['SOMETHING_NEW', 'The upload failed'],
      [null, 'The upload failed'],
    ]
    const files = reasons.map(([reason], index) =>
      makeWaitingFile({ relativePath: `file-${index}.csv`, reason, retryAt: NOW + 2 * MINUTE })
    )
    const { user } = await renderApp(
      makeState({ folders: [waitingFolder({ waitingFiles: files })] })
    )
    const sales = row('Sales')
    const toggle = sales.getByRole('button', { name: 'Show waiting files' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('Hide waiting files')

    reasons.forEach(([, copy], index) => {
      expect(sales.getByText(`file-${index}.csv`).nextSibling).toHaveTextContent(
        `${copy} · next try in 2 minutes`
      )
    })
    for (const [code] of reasons) if (code) expect(sales.queryByText(new RegExp(code))).toBeNull()
  })

  it('retries now and reports a failure next to the folder', async () => {
    const { api, user } = await renderApp(makeState({ folders: [waitingFolder()] }))
    const pending = deferred<DesktopResult<null>>()
    api.retryFolder.mockReturnValueOnce(pending.promise)

    const retry = row('Sales').getByRole('button', { name: 'Retry now' })
    expect(retry).toHaveAccessibleDescription(/12 files waiting/)
    await user.click(retry)
    expect(api.retryFolder).toHaveBeenCalledWith('sales')
    expect(retry).toBeDisabled()
    // The row menu waits for the retry too.
    expect(row('Sales').getByRole('button', { name: 'Actions for Sales' })).toBeDisabled()

    pending.resolve({ ok: false, error: 'network' })
    expect(await row('Sales').findByRole('alert')).toHaveTextContent("Teler can't be reached")
    expect(retry).toBeEnabled()

    api.retryFolder.mockRejectedValueOnce(new Error('bridge gone'))
    await user.click(retry)
    expect(await row('Sales').findByRole('alert')).toHaveTextContent(
      'Something went wrong with sync. Try again.'
    )
  })

  it('offers no retry while the folder or all sync is paused', async () => {
    const { api } = await renderApp(makeState({ folders: [waitingFolder({ status: 'paused' })] }))
    expect(row('Sales').queryByRole('button', { name: 'Retry now' })).toBeNull()

    act(() =>
      api.emit(makeState({ syncPaused: true, health: 'paused', folders: [waitingFolder()] }))
    )
    expect(await row('Sales').findByText(/12 files waiting/)).toBeVisible()
    expect(row('Sales').queryByRole('button', { name: 'Retry now' })).toBeNull()
  })
})

describe('upload limit', () => {
  it('explains the limit once, waits for it and offers retry when it ends', async () => {
    const until = NOW + 5 * MINUTE
    await renderApp(
      makeState({ health: 'syncing', throttledUntil: until, folders: [waitingFolder()] })
    )
    expect(screen.getByTestId('throttle-notice')).toHaveTextContent(
      `Teler limits how fast files upload. Uploads resume at ${clock(until)}.`
    )
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull()
    // Nothing starts before the limit ends, even files due sooner.
    expect(row('Sales').getByText(/next try in 5 minutes/)).toBeVisible()

    vi.setSystemTime(until + 1000)
    expect(
      await row('Sales').findByRole('button', { name: 'Retry now' }, { timeout: 2500 })
    ).toBeVisible()
    expect(screen.queryByTestId('throttle-notice')).toBeNull()
  })

  it('shows no notice when uploads are not limited', async () => {
    await renderApp(makeState({ throttledUntil: NOW - MINUTE, folders: [waitingFolder()] }))
    expect(screen.queryByTestId('throttle-notice')).toBeNull()
    expect(row('Sales').getByRole('button', { name: 'Retry now' })).toBeVisible()
  })
})

describe('status banner with waiting files', () => {
  it('reports waiting files as progress rather than a problem', async () => {
    await renderApp(makeState({ health: 'syncing', folders: [waitingFolder()] }))
    const banner = within(screen.getByTestId('status-banner'))
    expect(banner.getByRole('status')).toHaveTextContent('12 files waiting to upload')
    expect(banner.getByRole('status')).toHaveTextContent('Teler tries them again automatically.')
  })

  it('keeps counting pending files while some also wait', async () => {
    await renderApp(
      makeState({
        health: 'syncing',
        folders: [
          waitingFolder({ counts: { synced: 0, pending: 3, waiting: 2, problems: 0, skipped: 0 } }),
        ],
      })
    )
    expect(within(screen.getByTestId('status-banner')).getByRole('status')).toHaveTextContent(
      'Syncing 3 files…'
    )
  })
})
