import { ChevronRight } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Settings rows in the Notion Mail shape (REFERENCE-BRIEF §4.3): a sentence-
 * case group label in `ink-muted`, then rows with a 28px icon circle, a
 * label, an optional description and a trailing value, switch or chevron.
 * On a phone the group sits flat on the canvas with no card or dividers; a
 * desk gets a bordered card.
 *
 * Local to F4 until FOUNDATION's SettingsGroup/SettingsRow lands, then
 * these become thin re-exports. The rows are an `ul > li` with the link or
 * button inside the `li`, so list semantics survive.
 */
function SettingsGroup({
  label,
  action,
  footer,
  className,
  children,
}: {
  /** "You", "Workspace": sentence case, never uppercase. */
  label?: React.ReactNode
  /** A group-level text action on the right of the label ("Turn all on"). */
  action?: React.ReactNode
  /** A footnote below the group. */
  footer?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const id = React.useId()
  const labelId = label ? `${id}-label` : undefined
  const footerId = footer ? `${id}-footer` : undefined
  return (
    <div
      data-slot="settings-group"
      className={cn("flex flex-col gap-1.5", className)}
    >
      {label || action ? (
        <div className="flex min-h-(--np-touch) items-center justify-between gap-3 px-1 desk:min-h-0">
          {label ? (
            <p id={labelId} className="text-ui font-medium text-ink-muted">
              {label}
            </p>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      <ul
        aria-labelledby={labelId}
        aria-describedby={footerId}
        className="flex flex-col md:overflow-hidden md:rounded-(--np-radius-card) md:border md:border-line md:bg-surface"
      >
        {children}
      </ul>
      {footer ? (
        <p id={footerId} className="px-1 text-caption text-ink-muted">
          {footer}
        </p>
      ) : null}
    </div>
  )
}

type SettingsRowProps = {
  /** An 18px line icon; drawn in a 28px `fill-secondary` circle. */
  icon?: React.ReactNode
  label: React.ReactNode
  description?: React.ReactNode
  /** A value ("View only"), a Switch, a button. */
  trailing?: React.ReactNode
  /** Defaults to on for a link or button row. */
  chevron?: boolean
  href?: string
  onClick?: () => void
  className?: string
}

/**
 * One settings row: at least `--np-row-h` tall (52px touch, 44px desk), the
 * whole row is the link or button, and focus is an inset halo so the card
 * never clips it.
 */
function SettingsRow({
  icon,
  label,
  description,
  trailing,
  chevron,
  href,
  onClick,
  className,
}: SettingsRowProps) {
  const interactive = Boolean(href || onClick)
  const showChevron = chevron ?? interactive
  const content = (
    <>
      {icon ? (
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill-secondary text-ink-secondary [&_svg]:size-4.5 [&_svg]:[stroke-width:1.5]"
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body [overflow-wrap:anywhere] text-ink">
          {label}
        </span>
        {description ? (
          <span className="text-caption text-ink-muted">{description}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-2 text-ui text-ink-muted">
          {trailing}
        </span>
      ) : null}
      {showChevron ? (
        <ChevronRight
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-ink-faint"
        />
      ) : null}
    </>
  )
  const rowClass = cn(
    "flex min-h-(--np-row-h) w-full items-center gap-3 rounded-(--np-radius-card) px-1 py-2 text-left md:rounded-none md:px-(--np-card-pad)",
    interactive &&
      "transition-colors duration-(--np-duration-fast) ease-spring-snappy focus-visible:[box-shadow:inset_var(--np-focus-halo)] focus-visible:outline-none active:bg-fill hover-fine:hover:bg-surface-alt",
    className
  )
  return (
    <li
      data-slot="settings-row"
      className="md:border-t md:border-line md:first:border-t-0"
    >
      {href ? (
        <Link href={href} className={rowClass}>
          {content}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  )
}

export { SettingsGroup, SettingsRow }
