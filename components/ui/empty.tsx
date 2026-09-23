import { cn } from "@/lib/utils"

/**
 * An empty, all-clear or failed-load state (reference `.empty`): a 44px
 * rounded mark holding the glyph, a title, one muted sentence and the
 * actions, centred with generous padding. It draws no box of its own; put
 * it in a `Card flush` when it needs one.
 *
 * `tone="ok"` is the all-clear ("Nothing needs a reply"); `tone="bad"` is a
 * failed load, which must still name the cause and offer a retry. The
 * title is a `p` unless `titleAs` asks for a heading, so an empty state
 * never disturbs the page outline by accident.
 */
function Empty({
  title,
  description,
  action,
  icon,
  tone = "neutral",
  titleAs: Title = "p",
  className,
  children,
}: {
  title: string
  description?: React.ReactNode
  /** The next step. One primary action; a second is at most secondary. */
  action?: React.ReactNode
  /** A lucide glyph, drawn at 20px inside the mark. */
  icon?: React.ReactNode
  tone?: "neutral" | "ok" | "bad"
  titleAs?: "p" | "h2" | "h3"
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty"
      data-tone={tone}
      className={cn(
        "flex flex-col items-center justify-center gap-2.5 px-5 py-[clamp(32px,6vw,64px)] text-center",
        className
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "grid size-11 place-items-center rounded-(--np-radius-card) [&_svg]:size-5 [&_svg]:[stroke-width:1.75]",
            tone === "ok" && "bg-success-tint text-success-ink",
            tone === "bad" && "bg-danger-tint text-danger-ink",
            tone === "neutral" && "bg-fill text-ink-secondary"
          )}
        >
          {icon}
        </span>
      ) : null}
      {children}
      <Title className="text-title font-semibold text-balance text-ink">
        {title}
      </Title>
      {description ? (
        <p className="max-w-[46ch] text-ui text-ink-muted">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-1.5 flex flex-wrap justify-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  )
}

export { Empty }
