/** The appearance a signed-in user picks in Teler, which the desktop pages follow. */
export const COLOR_MODES = ['light', 'dark'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

export const THEME_VARIANTS = ['default', 'editorial', 'modernisme', 'dali', 'llobregat'] as const
export type ThemeVariant = (typeof THEME_VARIANTS)[number]
