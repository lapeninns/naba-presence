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
 * Black or white, whichever actually reads on the chosen colour.
 *
 * Not a hard-coded `text-white`: the colour is user-chosen, so a light one
 * would leave the initials invisible. It is also not a Tailwind class, because
 * `text-white` and the size utility `text-caption` collide in class merging —
 * a custom `text-*` name is ambiguous between colour and size, and the merge
 * dropped the colour, which is exactly how this shipped unreadable once.
 */
function inkFor(background: string): string {
  const parsed = parseColor(background)
  if (!parsed) return "#FFFFFF"
  const onWhite = contrastRatio(parseColor("#FFFFFF")!, parsed)
  const onBlack = contrastRatio(parseColor("#1A1714")!, parsed)
  return onWhite >= onBlack ? "#FFFFFF" : "#1A1714"
}

function initialsFor(name: string) {
  // "The Bell" and "The Barley Mow" should not both read "TB": a leading
  // article says nothing about which business it is.
  const words = name.trim().split(/\s+/).filter(Boolean)
  const meaningful =
    words.length > 1 && /^the$/i.test(words[0]) ? words.slice(1) : words
  const letters = meaningful
    .slice(0, 2)
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
      style={{ backgroundColor: background, color: inkFor(background) }}
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold select-none",
        SIZES[size],
        className
      )}
    >
      {initialsFor(name)}
    </span>
  )
}

export { ClientAvatar }
