import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/index'
import { CommandError } from '../src/errors'
import {
  publishedChecksum,
  removeUpdateLeftovers,
  replaceExecutable,
  runUpdateCommand,
} from '../src/update'
import { version } from '../package.json'
import { releaseListing, releaseServer } from './release-fixtures'

const COMPILED = 'file:///$bunfs/root/teler-linux-x64'
const NEW_BINARY = new TextEncoder().encode('#!/bin/sh\necho new\n')
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

let directory = ''
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ''
})

async function executable(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), 'teler-update-'))
  const path = join(directory, 'teler')
  await writeFile(path, 'old', { mode: 0o755 })
  return path
}

function server(sums = `${sha256(NEW_BINARY)}  teler-linux-x64\n`) {
  return releaseServer(
    releaseListing([
      {
        tag: 'cli-v0.2.0',
        assets: { 'teler-linux-x64': NEW_BINARY.byteLength, 'SHA256SUMS.txt': sums.length },
      },
    ]),
    { 'teler-linux-x64': NEW_BINARY, 'SHA256SUMS.txt': sums }
  )
}

function run(args: string[], deps: Parameters<typeof runUpdateCommand>[3], json = false) {
  let text = ''
  const result = runUpdateCommand(
    args[0],
    args.slice(1),
    { json, write: (t) => (text += t) },
    {
      currentVersion: '0.1.0',
      platform: 'linux',
      arch: 'x64',
      ...deps,
    }
  )
  return result.then(() => text)
}

describe('teler update', () => {
  test('--check reports a newer release without downloading it', async () => {
    const { fetch, requests } = server()
    const text = await run(['--check'], { fetch }, true)
    expect(JSON.parse(text)).toEqual({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      releaseUrl: 'https://github.com/teler-ai/teler-client/releases/tag/cli-v0.2.0',
    })
    expect(requests).toHaveLength(1)
    expect(await run(['--check'], { fetch })).toBe(
      'teler 0.2.0 is available (you have 0.1.0). Run `teler update` to install it.\n'
    )
  })

  test('says when it is up to date or nothing is released', async () => {
    expect(await run([], { fetch: server().fetch, currentVersion: '0.2.0' })).toBe(
      'teler 0.2.0 is up to date.\n'
    )
    expect(await run([], { fetch: releaseServer([]).fetch })).toBe(
      'No teler CLI release is available yet.\n'
    )
  })

  test('replaces a release build with the verified download', async () => {
    const path = await executable()
    const text = await run([], { fetch: server().fetch, moduleUrl: COMPILED, execPath: path })
    expect(text).toStartWith('Updated teler 0.1.0 → 0.2.0.\n')
    expect(await readFile(path, 'utf8')).toBe('#!/bin/sh\necho new\n')
    expect((await stat(path)).mode & 0o111).toBe(0o111)
    expect(await readdir(directory)).toEqual(['teler'])
  })

  test('changes nothing when the download does not match its checksum', async () => {
    const path = await executable()
    const update = run([], {
      fetch: server(`${'0'.repeat(64)}  teler-linux-x64\n`).fetch,
      moduleUrl: COMPILED,
      execPath: path,
    })
    await expect(update).rejects.toThrow('does not match its published checksum')
    expect(await readFile(path, 'utf8')).toBe('old')
    expect(await readdir(directory)).toEqual(['teler'])
  })

  test('refuses to update a source checkout or a platform without a build', async () => {
    const source = run([], { fetch: server().fetch, moduleUrl: 'file:///home/a/cli/src/update.ts' })
    await expect(source).rejects.toThrow('runs from source or a package')
    const mac = run([], { fetch: server().fetch, moduleUrl: COMPILED, platform: 'darwin' })
    await expect(mac).rejects.toThrow('has no build for this platform')
  })

  test('reports an unreachable release service as a stable error', async () => {
    const failing = async () => new Response('Not Found', { status: 404 })
    const error = await run([], { fetch: failing }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CommandError)
    expect((error as CommandError).code).toBe('UPDATE_CHECK_FAILED')
    expect((error as CommandError).message).toBe(
      'Could not check for teler updates (HTTP 404). Try again later.'
    )
  })
})

describe('executable replacement', () => {
  test('updates a symlinked executable where it lives', async () => {
    const path = await executable()
    const link = join(directory, 'teler-link')
    await symlink(path, link)
    await run([], { fetch: server().fetch, moduleUrl: COMPILED, execPath: link })
    expect(await readFile(path, 'utf8')).toBe('#!/bin/sh\necho new\n')
    expect((await readdir(directory)).sort()).toEqual(['teler', 'teler-link'])
  })

  test('removes an interrupted download once it is an hour old', async () => {
    const path = await executable()
    const stale = join(directory, '.teler-update-stale')
    const fresh = join(directory, '.teler-update-fresh')
    await writeFile(stale, 'partial')
    await writeFile(fresh, 'partial')
    const hourAgo = new Date(Date.now() - 2 * 60 * 60_000)
    await utimes(stale, hourAgo, hourAgo)
    await removeUpdateLeftovers(path)
    expect((await readdir(directory)).sort()).toEqual(['.teler-update-fresh', 'teler'])
  })

  test('on Windows moves the running executable aside, removed on a later run', async () => {
    const path = await executable()
    await replaceExecutable(path, NEW_BINARY, true)
    expect(await readFile(path)).toEqual(Buffer.from(NEW_BINARY))
    const aside = (await readdir(directory)).filter((name) => name.endsWith('.old'))
    expect(aside).toHaveLength(1)
    expect(await readFile(join(directory, aside[0] ?? ''), 'utf8')).toBe('old')
    await removeUpdateLeftovers(path)
    expect(await readdir(directory)).toEqual(['teler'])
  })

  test('reads sha256sum output in text and binary mode', () => {
    const sums = `${'a'.repeat(64)}  teler-linux-x64\n${'b'.repeat(64)} *teler-win-x64.exe\n`
    expect(publishedChecksum(sums, 'teler-linux-x64')).toBe('a'.repeat(64))
    expect(publishedChecksum(sums, 'teler-win-x64.exe')).toBe('b'.repeat(64))
    expect(publishedChecksum(sums, 'teler-mac-arm64')).toBeNull()
  })
})

describe('version and routing', () => {
  test('prints the version, as text or JSON', async () => {
    let out = ''
    expect(await main(['--version'], { writeOut: (text) => (out += text) })).toBe(0)
    expect(await main(['--version', '--json'], { writeOut: (text) => (out += text) })).toBe(0)
    expect(out).toBe(`teler ${version}\n${JSON.stringify({ version })}\n`)
  })

  test('runs `teler update` without signing in', async () => {
    let out = ''
    const code = await main(['update', '--check', '--json'], {
      env: {},
      fetch: server().fetch,
      writeOut: (text) => (out += text),
    })
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ currentVersion: version, latestVersion: '0.2.0' })
  })
})
