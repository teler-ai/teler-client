import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// The CLI is a standalone client of Teler's public HTTP API: it builds and runs
// without any code from the repository around it.
const PACKAGE_ROOT = join(import.meta.dir, '..')
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier)
}

describe('standalone package boundary', () => {
  it('depends only on published packages', () => {
    const local = Object.entries(dependencies).filter(([, version]) =>
      /^(workspace|link|file):/.test(version)
    )
    expect(local).toEqual([])
  })

  it('imports only builtins, its declared dependencies and its own files', () => {
    const outside: string[] = []
    for (const file of [
      ...sourceFiles(join(PACKAGE_ROOT, 'src')),
      ...sourceFiles(join(PACKAGE_ROOT, 'test')),
      ...sourceFiles(join(PACKAGE_ROOT, 'scripts')),
    ]) {
      for (const [, specifier] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        if (!specifier) continue
        if (/^(node|bun):/.test(specifier) || specifier === 'bun') continue
        const reference = `${relative(PACKAGE_ROOT, file)}: ${specifier}`
        if (specifier.startsWith('.')) {
          const target = relative(PACKAGE_ROOT, resolve(dirname(file), specifier))
          if (target.startsWith('..')) outside.push(reference)
        } else if (!(packageName(specifier) in dependencies)) {
          outside.push(reference)
        }
      }
    }
    expect(outside).toEqual([])
  })
})
