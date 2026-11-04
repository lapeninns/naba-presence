/**
 * The browser chrome colour per theme, mirroring --np-surface-canvas. Hex
 * because not every browser takes oklch in meta theme-color:
 * #f6f9fc ≈ oklch(0.98 0.005 250), #0d1216 ≈ oklch(0.18 0.012 240).
 */
// design-exempt-start R2: meta theme-color is read before any CSS loads
export const THEME_COLOR = {
  light: "#f6f9fc",
  dark: "#0d1216",
} as const
// design-exempt-end

export type ResolvedTheme = keyof typeof THEME_COLOR

/**
 * What each `<meta name="theme-color" media="(prefers-color-scheme: …)">`
 * should hold: the colour its media names while the theme follows the
 * system, and the chosen theme's colour for both once the person picks one
 * in-app, so the browser bar never stays light over a dark page.
 */
export function themeColorFor(
  media: string | null,
  forced: ResolvedTheme | null
): string {
  if (forced) return THEME_COLOR[forced]
  return media?.includes("dark") ? THEME_COLOR.dark : THEME_COLOR.light
}
