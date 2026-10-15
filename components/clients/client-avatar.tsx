import type * as React from "react"

import { CLIENT_COLOURS } from "@/lib/clients/colours"
import { contrastRatio, parseColor } from "@/lib/design/contrast"
import { cn } from "@/lib/utils"

/**
 * A client's mark: their chosen colour, or a stable one derived from the name.
 *
 * Derived rather than random so the same client keeps the same colour on every
 * screen and across sessions — an operator scanning a list of forty learns the
 * colours, and a mark that changed on each render would be worse than none.
 */
const PALETTE: readonly string[] = CLIENT_COLOURS.map((colour) => colour.value)

function colourFor(name: string, chosen: string | null) {
  if (chosen) return chosen
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

/**
 * The two inks the initials can take. Literal values, not tokens: the
 * contrast against a user-chosen colour is computed here at runtime, which
 * needs the actual colours, and a mark keeps the same ink in either theme
 * because its background does not change with the theme either.
 */
// design-exempt-start R2: runtime contrast against a user-chosen colour needs literal inks
const LIGHT_INK = "#FFFFFF"
const DARK_INK = "#1A1714"
// design-exempt-end

/**
 * Black or white, whichever actually reads on the chosen colour.
 *
 * Not a hard-coded `text-white`: the colour is user-chosen, so a light one
 * would leave the initials invisible. It reaches CSS as a custom property
 * read by `text-(color:--client-mark-ink)`: the `color:` hint keeps class
 * merging from mistaking it for the size utility (`text-caption`) and
 * dropping it, which is exactly how this shipped unreadable once.
 */
function inkFor(background: string): string {
  const parsed = parseColor(background)
  if (!parsed) return LIGHT_INK
  const onLight = contrastRatio(parseColor(LIGHT_INK)!, parsed)
  const onDark = contrastRatio(parseColor(DARK_INK)!, parsed)
  return onLight >= onDark ? LIGHT_INK : DARK_INK
}

function initialsFor(name: string, count = 2) {
  // "The Bell" and "The Barley Mow" should not both read "TB": a leading
  // article says nothing about which business it is.
  const words = name.trim().split(/\s+/).filter(Boolean)
  const meaningful =
    words.length > 1 && /^the$/i.test(words[0]) ? words.slice(1) : words
  const letters = meaningful
    .slice(0, count)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return letters || "?"
}

/**
 * A rounded square, not a circle: circles are for people, and a client is a
 * business. The radius grows with the size so the corners stay concentric
 * with whatever card the mark sits in.
 */
const SIZES = {
  /**
   * Inline in a control: the top-bar client switcher and its menu. One
   * letter, so it can be set at the caption size (never below 12px) and
   * still fit the 20px mark.
   */
  xs: "size-5 rounded-(--np-radius-tag) text-caption",
  sm: "size-8 rounded-(--np-radius-control) text-ui",
  lg: "size-12 rounded-(--np-radius-card) text-title",
  xl: "size-16 rounded-(--np-radius-panel) text-section",
} as const

function ClientAvatar({
  name,
  colour = null,
  size = "sm",
  className,
}: {
  name: string
  colour?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  const background = colourFor(name, colour)
  return (
    <span
      aria-hidden
      data-slot="client-avatar"
      data-size={size}
      style={
        {
          "--client-mark": background,
          "--client-mark-ink": inkFor(background),
        } as React.CSSProperties
      }
      className={cn(
        "flex shrink-0 items-center justify-center bg-(--client-mark) font-semibold text-(color:--client-mark-ink) select-none",
        SIZES[size],
        className
      )}
    >
      {initialsFor(name, size === "xs" ? 1 : 2)}
    </span>
  )
}

export { ClientAvatar, colourFor }
