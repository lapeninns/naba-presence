/**
 * The status vocabulary: five tones, used everywhere something has a state.
 *
 * Before this there were four private maps — the shell's connection chip, the
 * inbox's situation tone, the editor's diff badge and the client health word —
 * each with its own colours and its own idea of how many states exist. Two of
 * them disagreed about what "warning" looked like.
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
 * Tailwind classes per tone, reading the measured token pairs.
 *
 * `text` on `tint` is the pill: every pair clears 4.5:1 in both themes
 * (lib/design/contrast-pairs.ts), which is why status text no longer has to
 * fall back to plain foreground the way the old badge variants did.
 *
 * `dot` is the vivid, solid step of each family: the dot is a graphic, not
 * text, so it only has to clear 3:1 and can afford to be bright. Neutral has
 * no solid step; its dot is the strong line, the one grey that clears 3:1.
 */
export const TONE_CLASSES: Record<
  StatusTone,
  { text: string; tint: string; dot: string }
> = {
  healthy: {
    text: "text-success-ink",
    tint: "bg-success-tint",
    dot: "bg-[var(--np-success-solid)]",
  },
  attention: {
    text: "text-warning-ink",
    tint: "bg-warning-tint",
    dot: "bg-[var(--np-warning-ink)]",
  },
  "at-risk": {
    text: "text-danger-ink",
    tint: "bg-danger-tint",
    dot: "bg-[var(--np-danger-solid)]",
  },
  pending: {
    text: "text-info-ink",
    tint: "bg-info-tint",
    dot: "bg-[var(--np-info-solid)]",
  },
  neutral: {
    text: "text-ink-muted",
    tint: "bg-fill",
    dot: "bg-[var(--np-line-strong)]",
  },
}
