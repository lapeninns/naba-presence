/**
 * The count figure: the small mono number beside a chip, tab, segment or
 * badge label ("Needs reply 12"), and a KPI delta.
 *
 * It reads `--np-text-count` (13px on touch, 12px on a desk, never the old
 * 11.5px literal), falling back to the caption size until that token lands
 * in app/globals.css. Written as one font-size utility on a custom property,
 * not as `text-count`, because tailwind-merge does not know `text-count` yet
 * and files it under text COLOUR: `cn("text-count text-ink-muted")` drops
 * one of the two. Once globals.css defines `--text-count` and lib/utils.ts
 * registers "count" in the font-size group, this can become `text-count`
 * with no visual change.
 *
 * Leading is `none`: a count sits inside a control whose height is set by
 * the control, never by the figure.
 */
export const COUNT_TEXT_CLASS =
  "font-mono text-[length:var(--np-text-count,var(--np-text-caption))] leading-none tabular-nums"
