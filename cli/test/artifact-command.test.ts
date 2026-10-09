import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelerApiClient } from '../src/api'
import { runArtifactCommand } from '../src/artifact-command'

const suffix = '01m2mgs69ge8nvmkdg6924cgg9'
const id = `artifact_${suffix}`
const chatId = `chat_${suffix}`
const metadata = {
  id,
  chatId,
  jobId: `expjob_${suffix}`,
  slug: 'revenue',
  category: 'chart',
  type: 'bar',
  title: 'Revenue',
  description: null,
  createdAt: '2026-10-07T00:00:00.000Z',
  dataSizeBytes: 2,
  storageKey: 'private/physical/key',
  config: { private: true },
}

test('artifact metadata resolves exact identity and strips storage details', async () => {
  const paths: string[] = []
  let output = ''
  const client = new TelerApiClient(new URL('https://app.example.test'), 'token', async (url) => {
    const path = new URL(url).pathname
    paths.push(path)
    return Response.json(
      paths.length === 1 ? { artifacts: [metadata], truncated: false } : metadata
    )
  })
  expect(
    await runArtifactCommand('artifact', 'get', [id, '--chat', chatId], client, {
      json: true,
      metadataOnly: false,
      write: (value) => {
        output += value
      },
    })
  ).toBe(true)
  expect(paths).toEqual([`/api/chat/${chatId}/artifact`, `/api/chat/${chatId}/artifact/revenue`])
  expect(JSON.parse(output)).toMatchObject({ id, title: 'Revenue' })
  expect(output).not.toContain('private')
  expect(output).not.toContain('storageKey')
})

test('invalid input never fetches and mismatched artifact metadata is rejected', async () => {
  let calls = 0
  const client = new TelerApiClient(new URL('https://app.example.test'), 'token', async () => {
    calls++
    return Response.json({ ...metadata, chatId: `chat_01m2mgs69ge8nvmkdg6924cgg8` })
  })
  const output = { json: true, metadataOnly: false, write: () => undefined }
  await expect(
    runArtifactCommand(
      'artifact',
      'get',
      [id, '--chat', chatId, '--output', '/tmp/file'],
      client,
      output
    )
  ).rejects.toThrow()
  expect(calls).toBe(0)
  await expect(
    runArtifactCommand(
      'artifact',
      'get',
      [id, '--chat', chatId, '--slug', 'revenue'],
      client,
      output
    )
  ).rejects.toMatchObject({ status: 502 })
})

test('a truncated list provides a recovery path instead of claiming the artifact is missing', async () => {
  const client = new TelerApiClient(new URL('https://app.example.test'), 'token', async () =>
    Response.json({ artifacts: [], truncated: true })
  )
  await expect(
    runArtifactCommand('artifact', 'get', [id, '--chat', chatId], client, {
      json: true,
      metadataOnly: false,
      write: () => undefined,
    })
  ).rejects.toThrow('--slug')
})

test('download writes exact bytes, refuses existing destinations and cleans temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'teler-artifact-test-'))
  const destination = join(directory, 'chart.json')
  try {
    const client = new TelerApiClient(new URL('https://app.example.test'), 'token', async (url) =>
      url.endsWith('/data') ? new Response('{}') : Response.json(metadata)
    )
    const args = [id, '--chat', chatId, '--slug', 'revenue', '--download', '--output', destination]
    await runArtifactCommand('artifact', 'get', [...args], client, {
      json: true,
      metadataOnly: false,
      write: () => undefined,
    })
    expect(await readFile(destination, 'utf8')).toBe('{}')
    await writeFile(destination, 'preserve')
    await expect(
      runArtifactCommand('artifact', 'get', [...args], client, {
        json: true,
        metadataOnly: false,
        write: () => undefined,
      })
    ).rejects.toThrow()
    expect(await readFile(destination, 'utf8')).toBe('preserve')
    expect(await readdir(directory)).toEqual(['chart.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
