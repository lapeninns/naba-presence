/**
 * The status vocabulary: five tones, used everywhere something has a state.
 *
 * Before this there were about ten private vocabularies for the same five
 * states — the shell's connection chip, the inbox's situation tone, the
 * editor's diff badge, the client health word, the reference pill names
 * (ok/warn/bad/info), the alert and KPI intents (success/warning/danger) —
 * each with its own colours and its own idea of how many states exist.
 *
 * This file is the single source. A primitive that shows a state (StatusPill,
 * Badge's status variants, Timeline marks, KpiTile deltas) reads its classes
 * from `TONE_CLASSES` through `resolveTone`, so a synonym can never drift into
 * its own colour. Domain code maps its own states to a tone here or beside
 * the domain (lib/listings/health.ts) and never picks a colour.
 *
 * Pure and client-safe, so a server component and a test can read it too.
 */

export const STATUS_TONES = [
  "healthy",
  "attention",
  "at-risk",
  "pending",
  "neutral",
] as const
export type StatusTone = (typeof STATUS_TONES)[number]

/**
 * Accepted synonyms, each resolving to one of the five tones:
 *
 * - the reference pill names (np.css `.pill.ok/.warn/.bad/.info`), so a
 *   caller can say what the reference says without a mapping table;
 * - the intent names Alert, KpiTile and Timeline used (`success`, `warning`,
 *   `danger`, `info`).
 *
 * New code should write the five tones themselves; the aliases keep the
 * existing call sites valid.
 */
export const TONE_ALIASES = {
  ok: "healthy",
  success: "healthy",
  warn: "attention",
  warning: "attention",
  bad: "at-risk",
  danger: "at-risk",
  info: "pending",
} as const satisfies Record<string, StatusTone>
export type ToneAlias = keyof typeof TONE_ALIASES

/** Any name a primitive accepts for a state: a tone or one of its aliases. */
export type ToneName = StatusTone | ToneAlias

/** The tone a name stands for. */
export function resolveTone(tone: ToneName): StatusTone {
  return (
    (TONE_ALIASES as Record<string, StatusTone>)[tone] ?? (tone as StatusTone)
  )
}

/** True for the five tones and their aliases; false for anything else. */
export function isToneName(value: unknown): value is ToneName {
  return (
    typeof value === "string" &&
    ((STATUS_TONES as readonly string[]).includes(value) ||
      value in TONE_ALIASES)
  )
}

/**
 * Tailwind classes per tone, reading the measured token pairs.
 *
 * `text` on `tint` is the pill: every pair clears 4.5:1 in both themes
 * (lib/design/contrast-pairs.ts), which is why status text no longer has to
 * fall back to plain foreground the way the old badge variants did. Neutral
 * is the secondary ink on the grey fill: one step stronger than the measured
 * muted-on-fill pair in both themes, and the same in every primitive (the
 * pill and this map used to disagree).
 *
 * `dot` is the solid step of each family (reference `.dot.ok/.warn/.bad/
 * .info`). A dot always sits beside the word it reinforces, so it is never
 * the only signal. Neutral's dot is the muted ink.
 */
export const TONE_CLASSES: Record<
  StatusTone,
  { text: string; tint: string; dot: string }
> = {
  healthy: {
    text: "text-success-ink",
    tint: "bg-success-tint",
    dot: "bg-success-solid",
  },
  attention: {
    text: "text-warning-ink",
    tint: "bg-warning-tint",
    dot: "bg-warning-solid",
  },
  "at-risk": {
    text: "text-danger-ink",
    tint: "bg-danger-tint",
    dot: "bg-danger-solid",
  },
  pending: {
    text: "text-info-ink",
    tint: "bg-info-tint",
    dot: "bg-info-solid",
  },
  neutral: {
    text: "text-ink-secondary",
    tint: "bg-fill",
    dot: "bg-ink-muted",
  },
}

/** `TONE_CLASSES` for any tone name, alias included. */
export function toneClasses(tone: ToneName) {
  return TONE_CLASSES[resolveTone(tone)]
}
