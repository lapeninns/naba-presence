import { cn } from "@/lib/utils"

/**
 * The glyph: a serif "N" set in a 30px ink square. There is no logo yet, so
 * this is the mark; a fixed brand asset can replace it here without touching
 * any caller. `inverse` is for the charcoal auth panel, where the square
 * flips to the on-charcoal ink.
 */
function BrandGlyph({
  inverse = false,
  className,
}: {
  inverse?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      translate="no"
      className={cn(
        "grid size-[30px] shrink-0 place-items-center rounded-md font-display text-[17px] leading-none font-bold",
        inverse ? "bg-ink-on-charcoal text-charcoal" : "bg-ink text-canvas",
        className
      )}
    >
      N
    </span>
  )
}

/** The product name as a word, never translated. */
function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold text-ink", className)} translate="no">
      NabaPresence
    </span>
  )
}

/**
 * The glyph beside one or two lines of text.
 *
 * In the sidebar the primary line is the organisation's (the person in the
 * tool all day is an agency, and the sidebar leads with the workspace, not
 * the vendor) and the product becomes a mono caption. The auth screens show
 * the product name alone at title size.
 */
function BrandMark({
  size = "sm",
  title,
  subtitle,
  inverse = false,
  className,
  textClassName,
}: {
  size?: "sm" | "lg"
  /** The primary line. Defaults to the product name. */
  title?: React.ReactNode
  /** A mono caption under the title. */
  subtitle?: React.ReactNode
  inverse?: boolean
  className?: string
  /** Classes for the text column, e.g. to hide it in the icon rail. */
  textClassName?: string
}) {
  const large = size === "lg"
  return (
    <span
      data-slot="brand-mark"
      className={cn("flex min-w-0 items-center gap-2.5", className)}
    >
      <BrandGlyph inverse={inverse} />
      <span className={cn("flex min-w-0 flex-col", textClassName)}>
        <span
          className={cn(
            "truncate",
            inverse ? "text-ink-on-charcoal" : "text-ink",
            large
              ? "text-title font-semibold tracking-[-0.005em]"
              : "text-ui leading-[18px] font-semibold"
          )}
        >
          {title ?? <Wordmark className="text-inherit" />}
        </span>
        {/* A space for the accessible name ("Lapen Inns NabaPresence");
            whitespace in a flex column draws nothing. */}
        {subtitle ? " " : null}
        {subtitle ? (
          <span
            className={cn(
              "truncate font-mono text-[11px] leading-[14px] tracking-[0.02em]",
              inverse ? "text-ink-muted-on-charcoal" : "text-ink-muted"
            )}
            translate="no"
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  )
}

export { BrandGlyph, BrandMark, Wordmark }
