import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Teler Desktop is a standalone client of Teler's public HTTP API. It builds
// with published packages and its sibling `@teler-ai/cli`, and nothing else.
const PACKAGE_ROOT = join(import.meta.dirname, '..')
const SIBLINGS = new Set(['@teler-ai/cli'])
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
const CODE = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*)['"]([^'"]+)['"]/g
const CSS = /@(?:import|plugin)\s+(?:url\(\s*)?['"]([^'"]+)['"]/g
const SCANNED = /\.(?:[cm]?[jt]sx?|css)$/

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path)
    return SCANNED.test(entry.name) ? [path] : []
  })
}

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier)
}

describe('standalone package boundary', () => {
  it('depends only on published packages and its sibling CLI', () => {
    const local = Object.entries(dependencies).filter(
      ([name, version]) => /^(workspace|link|file):/.test(version) && !SIBLINGS.has(name)
    )
    expect(local).toEqual([])
  })

  it('imports only builtins, its declared dependencies and its own files', () => {
    const roots = ['src', 'test', 'scripts'].map((name) => join(PACKAGE_ROOT, name))
    const configs = readdirSync(PACKAGE_ROOT)
      .filter((name) => SCANNED.test(name))
      .map((name) => join(PACKAGE_ROOT, name))
    const outside: string[] = []
    for (const file of [...roots.flatMap(files), ...configs]) {
      const text = readFileSync(file, 'utf8')
      const specifiers = [...text.matchAll(file.endsWith('.css') ? CSS : CODE)].map(
        ([, specifier]) => specifier ?? ''
      )
      for (const specifier of specifiers) {
        if (!specifier || /^(node|bun):/.test(specifier) || specifier === 'electron') continue
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
