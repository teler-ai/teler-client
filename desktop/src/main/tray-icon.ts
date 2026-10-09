import type { SyncHealth } from '../shared/desktop-api'

/**
 * Tray icons are derived at runtime from the app icon, so no per-state image
 * assets are needed. Electron bitmaps are 32-bit BGRA rows.
 */
export type BadgeTone = 'active' | 'warning' | 'error' | 'muted'

const TONE_RGB: Record<BadgeTone, readonly [number, number, number]> = {
  active: [37, 99, 235],
  warning: [217, 119, 6],
  error: [220, 38, 38],
  muted: [100, 116, 139],
}

export function badgeToneFor(health: SyncHealth): BadgeTone | null {
  switch (health) {
    case 'up-to-date':
    case 'no-folders':
      return null
    case 'syncing':
      return 'active'
    case 'paused':
    case 'not-connected':
      return 'muted'
    case 'sign-in-required':
      return 'error'
    case 'attention':
    case 'offline':
    case 'stopped':
      return 'warning'
  }
}

/** Draws a status dot in the bottom-right corner, separated by a transparent ring. */
export function drawBadge(
  bitmap: Uint8Array,
  width: number,
  height: number,
  tone: BadgeTone
): Uint8Array {
  const output = Uint8Array.from(bitmap)
  const radius = Math.max(2, Math.round(width * 0.2))
  const centerX = width - radius - 1
  const centerY = height - radius - 1
  const [red, green, blue] = TONE_RGB[tone]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY)
      if (distance > radius + 1) continue
      const offset = (y * width + x) * 4
      const fill = distance <= radius
      output[offset] = fill ? blue : 0
      output[offset + 1] = fill ? green : 0
      output[offset + 2] = fill ? red : 0
      output[offset + 3] = fill ? 255 : 0
    }
  }
  return output
}

/**
 * macOS tints template icons to match the menu bar (white on dark, black on
 * light), so a state can show only through shape and opacity.
 */
export type TemplateMark = 'none' | 'ring' | 'dot' | 'dim'

export function templateMarkFor(tone: BadgeTone | null): TemplateMark {
  if (tone === null) return 'none'
  if (tone === 'active') return 'ring'
  if (tone === 'muted') return 'dim'
  return 'dot'
}

/** Draws a template mark in black: a hollow ring, a solid dot, or a dimmed icon. */
export function drawTemplateMark(
  bitmap: Uint8Array,
  width: number,
  height: number,
  mark: TemplateMark
): Uint8Array {
  const output = Uint8Array.from(bitmap)
  if (mark === 'none') return output
  if (mark === 'dim') {
    for (let offset = 3; offset < output.length; offset += 4)
      output[offset] = Math.round(output[offset]! * 0.45)
    return output
  }
  const radius = Math.max(2, Math.round(width * 0.2))
  const inner = mark === 'ring' ? radius - Math.max(1, Math.round(width / 16)) : -1
  const centerX = width - radius - 1
  const centerY = height - radius - 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY)
      if (distance > radius + 1) continue
      const offset = (y * width + x) * 4
      output[offset] = 0
      output[offset + 1] = 0
      output[offset + 2] = 0
      output[offset + 3] = distance <= radius && distance > inner ? 255 : 0
    }
  }
  return output
}

/** A black silhouette with the original alpha, for macOS template images. */
export function toTemplate(bitmap: Uint8Array): Uint8Array {
  const output = Uint8Array.from(bitmap)
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = 0
    output[offset + 1] = 0
    output[offset + 2] = 0
  }
  return output
}
