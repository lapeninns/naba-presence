/**
 * The count figure: the small number beside a chip, tab, segment or badge
 * label ("Needs reply 12"), and a KPI delta. Sans with tabular figures
 * (D1: mono is only for IDs, codes and figures in tables).
 *
 * It is the `text-count` type role (13px on touch, 12px on a desk, never
 * the old 11.5px literal). lib/utils.ts registers "count" in
 * tailwind-merge's font-size group, so `cn(COUNT_TEXT_CLASS, "text-ink-muted")`
 * keeps both the size and the colour.
 *
 * Leading is `none`: a count sits inside a control whose height is set by
 * the control, never by the figure.
 */
export const COUNT_TEXT_CLASS =
  "text-count leading-none tabular-nums"
