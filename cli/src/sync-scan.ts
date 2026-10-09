import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readFile, readdir } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import { protectedSyncPaths } from './sync-paths'
import type { SyncSkipped, SyncSnapshot } from './sync-types'

const EXCLUDED = new Set([
  '.git',
  'node_modules',
  '.ssh',
  '.aws',
  '.kube',
  '.codex',
  '.agents',
  'dist',
  'build',
  '.next',
  '.telerignore',
  'id_rsa',
  'id_ed25519',
  'credentials.json',
])
const SUPPORTED = /\.(csv|tsv|xlsx?|ods|jsonl?|ndjson|txt|md|docx|html?|rtf|pdf|png|jpe?g|webp)$/i
function excluded(name: string) {
  return (
    EXCLUDED.has(name) ||
    /^\.env(?:\.|$)/.test(name) ||
    /(?:\.pem|\.key|\.p12|\.pfx|\.swp|\.tmp|\.part|~)$/i.test(name) ||
    /^~\$/.test(name)
  )
}
function ignored(path: string, patterns: string[]): boolean {
  return patterns.some((raw) => {
    const pattern = raw.replace(/^\//, '').replace(/\/$/, '')
    const glob = new Bun.Glob(pattern)
    return (
      glob.match(path) ||
      (!pattern.includes('/') && path.split('/').some((part) => glob.match(part))) ||
      path.startsWith(`${pattern}/`)
    )
  })
}
export async function scanFolder(
  root: string,
  stableMs = 1_000,
  protectedPaths = protectedSyncPaths(process.env),
  signal?: AbortSignal
): Promise<{ files: SyncSnapshot[]; skipped: SyncSkipped[] }> {
  signal?.throwIfAborted()
  const protectedRoots = await Promise.all(
    protectedPaths.map(async (path) => realpath(path).catch(() => resolve(path)))
  )
  const isProtected = (path: string) =>
    protectedRoots.some(
      (protectedRoot) => path === protectedRoot || path.startsWith(`${protectedRoot}${sep}`)
    )
  if (isProtected(root)) return { files: [], skipped: [{ relativePath: '.', reason: 'excluded' }] }
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Sync root is unavailable')
  let patterns: string[] = []
  try {
    const ignoreInfo = await lstat(join(root, '.telerignore'))
    if (ignoreInfo.isSymbolicLink()) throw new Error('Sync ignore file cannot be a symlink')
    patterns = (await readFile(join(root, '.telerignore'), 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw new Error('Sync ignore file is unreadable')
  }
  const files: SyncSnapshot[] = []
  const skipped: SyncSkipped[] = []
  async function visit(relative: string) {
    if ((await realpath(join(root, relative))) !== join(root, relative))
      throw new Error('Sync directory changed')
    signal?.throwIfAborted()
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      signal?.throwIfAborted()
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        skipped.push({ relativePath: path, reason: 'symlink' })
        continue
      }
      if (excluded(entry.name) || ignored(path, patterns) || isProtected(join(root, path))) {
        skipped.push({ relativePath: path, reason: 'excluded' })
        continue
      }
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !SUPPORTED.test(entry.name)) {
        skipped.push({ relativePath: path, reason: 'unsupported' })
        continue
      }
      try {
        const resolved = await realpath(join(root, path))
        if (!resolved.startsWith(`${root}${sep}`) || resolved !== join(root, path)) {
          skipped.push({ relativePath: path, reason: 'symlink' })
          continue
        }
        const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const before = await handle.stat()
          if (!before.isFile() || (stableMs > 0 && Date.now() - before.mtimeMs < stableMs)) {
            skipped.push({ relativePath: path, reason: 'unstable' })
            continue
          }
          const hash = createHash('sha256')
          for await (const chunk of handle.createReadStream({ autoClose: false }))
            hash.update(chunk)
          const after = await handle.stat()
          if ((await realpath(join(root, path))) !== resolved) {
            skipped.push({ relativePath: path, reason: 'symlink' })
            continue
          }
          if (
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ctimeMs !== after.ctimeMs
          ) {
            skipped.push({ relativePath: path, reason: 'unstable' })
            continue
          }
          if (!before.size) {
            skipped.push({ relativePath: path, reason: 'empty' })
            continue
          }
          files.push({
            relativePath: path,
            hash: hash.digest('hex'),
            localPath: join(root, path),
            size: before.size,
          })
        } finally {
          await handle.close()
        }
      } catch {
        skipped.push({ relativePath: path, reason: 'unreadable' })
      }
    }
  }
  await visit('')
  signal?.throwIfAborted()
  return { files, skipped }
}
