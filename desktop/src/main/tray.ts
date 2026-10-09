import {
  Menu,
  Tray,
  nativeImage,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron'
import type { Translate } from './i18n'
import {
  badgeToneFor,
  drawBadge,
  drawTemplateMark,
  templateMarkFor,
  toTemplate,
  type BadgeTone,
} from './tray-icon'
import { buildTrayMenu, trayTooltip, type TrayAction, type TrayState } from './tray-menu'

// macOS and Windows tray icons are 16pt (with a 2x representation); Linux
// indicators use a single larger bitmap.
function iconSizes(platform: NodeJS.Platform): Array<[size: number, scaleFactor: number]> {
  return platform === 'linux'
    ? [[24, 1]]
    : [
        [16, 1],
        [32, 2],
      ]
}

function trayImage(source: NativeImage, platform: NodeJS.Platform, tone: BadgeTone | null) {
  // macOS menu bar icons are always templates, tinted white or black to match
  // the menu bar; elsewhere the icon keeps its colours and a coloured badge.
  const template = platform === 'darwin'
  const image = nativeImage.createEmpty()
  for (const [size, scaleFactor] of iconSizes(platform)) {
    const resized = source.resize({ width: size, height: size, quality: 'best' })
    let bitmap: Uint8Array = new Uint8Array(resized.toBitmap())
    if (template) bitmap = drawTemplateMark(toTemplate(bitmap), size, size, templateMarkFor(tone))
    else if (tone) bitmap = drawBadge(bitmap, size, size, tone)
    const png = nativeImage
      .createFromBitmap(Buffer.from(bitmap), { width: size, height: size })
      .toPNG()
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: png })
  }
  if (template) image.setTemplateImage(true)
  return image
}

export class TrayController {
  private readonly tray: Tray
  private readonly source: NativeImage
  private readonly images = new Map<string, NativeImage>()
  private tone: BadgeTone | null | undefined

  constructor(
    iconPath: string,
    private readonly platform: NodeJS.Platform,
    private readonly onAction: (action: TrayAction) => void
  ) {
    this.source = nativeImage.createFromPath(iconPath)
    this.tray = new Tray(this.image(null))
    // Windows users expect a left click on the tray icon to open the app.
    if (platform === 'win32') this.tray.on('click', () => onAction('open-teler'))
  }

  update(state: TrayState, t: Translate): void {
    const tone = badgeToneFor(state.health)
    if (tone !== this.tone) {
      this.tone = tone
      this.tray.setImage(this.image(tone))
    }
    this.tray.setToolTip(trayTooltip(state, t))
    this.tray.setContextMenu(Menu.buildFromTemplate(this.template(state, t)))
  }

  destroy(): void {
    this.tray.destroy()
  }

  private image(tone: BadgeTone | null): NativeImage {
    const key = tone ?? 'plain'
    let image = this.images.get(key)
    if (!image) {
      image = trayImage(this.source, this.platform, tone)
      this.images.set(key, image)
    }
    return image
  }

  private template(state: TrayState, t: Translate): MenuItemConstructorOptions[] {
    return buildTrayMenu(state, t).map((item): MenuItemConstructorOptions => {
      switch (item.type) {
        case 'separator':
          return { type: 'separator' }
        case 'checkbox':
          return {
            type: 'checkbox',
            label: item.label,
            checked: item.checked,
            click: () => this.onAction(item.action),
          }
        case 'action':
          return { label: item.label, click: () => this.onAction(item.action) }
      }
    })
  }
}
