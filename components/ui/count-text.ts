import type { ReactNode } from "react"

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
export const COUNT_TEXT_CLASS = "text-count leading-none tabular-nums"

/**
 * The one zero rule for every count strip (tabs, chips): a count of zero
 * draws no figure at all, not "0" and not a dash. A dash reads as "unknown"
 * or "still loading", and a lone "0" on one strip beside a blank on another
 * made the strips disagree. A tab or chip with no figure means nothing is in
 * it; a control that must say so aloud puts the zero in its own accessible
 * name (the inbox's "Publishing, 0 reviews").
 *
 * True for the number 0 and for the text "0" (a figure already passed
 * through `formatNumber`).
 */
export function isZeroCount(count: ReactNode): boolean {
  if (typeof count === "number") return count === 0
  if (typeof count === "string") return count.trim() === "0"
  return false
}
