import { cn } from "@/lib/utils"

/**
 * An empty state: a light glyph, a title, one sentence and one action.
 *
 * It draws no box of its own. On the canvas it sits in the open, the way
 * Finder says "No items"; inside a card it inherits the card. The glyph is
 * decorative and faint; the title carries the meaning, so a screen reader
 * hears the same thing a sighted reader sees.
 */
function Empty({
  title,
  description,
  action,
  icon,
  className,
  children,
}: {
  title: string
  description?: string
  /** One primary action. Two is a decision the empty state should have made. */
  action?: React.ReactNode
  /** A lucide glyph. Rendered light and large above the title. */
  icon?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center justify-center gap-1 px-6 py-12 text-center",
        className
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className="mb-3 flex text-ink-faint [&_svg]:size-8 [&_svg]:stroke-[1.25]"
        >
          {icon}
        </span>
      ) : null}
      {children}
      <p className="text-title font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-ui text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export { Empty }
