import { ChevronRight } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * An iOS inset-grouped list: a white card of rows on the grey canvas, with a
 * caption above and a footnote below. For settings, profile and any screen
 * that is a column of labelled rows.
 *
 * The rows are an `ul > li`, and an interactive row puts its link or button
 * INSIDE the `li`, so list semantics survive whatever the row becomes.
 */
function GroupedList({
  header,
  footer,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"ul">, "children"> & {
  /** A short caption above the group, e.g. "Notifications". */
  header?: React.ReactNode
  /** A footnote below the group, e.g. what a switch controls. */
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const id = React.useId()
  const headerId = header ? `${id}-header` : undefined
  const footerId = footer ? `${id}-footer` : undefined
  return (
    <div data-slot="grouped-list" className={cn("flex flex-col gap-1.5", className)}>
      {header ? (
        <p id={headerId} className="px-(--np-card-pad) text-caption text-ink-muted">
          {header}
        </p>
      ) : null}
      <ul
        aria-labelledby={headerId}
        aria-describedby={footerId}
        className="overflow-hidden rounded-(--np-radius-card) bg-surface"
        {...props}
      >
        {children}
      </ul>
      {footer ? (
        <p id={footerId} className="px-(--np-card-pad) text-caption text-ink-muted">
          {footer}
        </p>
      ) : null}
    </div>
  )
}

type GroupedListItemBase = {
  /** A lucide icon, or any 16px glyph. Sits in a 20px slot before the label. */
  icon?: React.ReactNode
  label: React.ReactNode
  description?: React.ReactNode
  /**
   * The trailing slot: a value ("On"), a Switch, a Badge. A chevron is added
   * after it automatically on a navigational row.
   */
  trailing?: React.ReactNode
  /**
   * Forces the chevron on or off. Defaults to on when `href` or `onClick`
   * is given, off otherwise.
   */
  chevron?: boolean
  /** `danger` is the destructive row: "Sign out", "Delete account". */
  tone?: "default" | "danger"
  disabled?: boolean
  className?: string
} & Omit<React.HTMLAttributes<HTMLElement>, "onClick" | "children" | "className">

type GroupedListItemProps = GroupedListItemBase & {
  /** Renders the row as a Link. */
  href?: string
  /** Renders the row as a button. Ignored when `href` is set. */
  onClick?: () => void
}

/**
 * One row of a `GroupedList`.
 *
 * The row is a Link when `href` is given, a button when `onClick` is given
 * and a plain div otherwise, so a row that only presents a value costs no
 * tab stop. The separator is a pseudo-element indented to the label's left
 * edge, past the icon when there is one, the way the platform draws it.
 *
 * The focus halo is drawn inset: the group clips its corners, so an outer
 * halo would be cut off at the card's edge.
 */
function GroupedListItem({
  icon,
  label,
  description,
  trailing,
  chevron,
  tone = "default",
  disabled = false,
  href,
  onClick,
  className,
  ...rest
}: GroupedListItemProps) {
  const interactive = Boolean(href || onClick)
  const showChevron = chevron ?? interactive

  const content = (
    <>
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "flex size-5 shrink-0 items-center justify-center [&_svg]:size-4 [&_svg]:[stroke-width:1.75]",
            tone === "danger" ? "text-danger-ink" : "text-ink-muted"
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate text-body",
            tone === "danger" ? "text-danger-ink" : "text-ink"
          )}
        >
          {label}
        </span>
        {description ? (
          <span className="text-caption text-ink-muted">{description}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-2 text-body text-ink-muted tabular-nums">
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
    "flex w-full min-h-(--np-row-h) items-center gap-3 px-(--np-card-pad) py-2 text-left",
    interactive &&
      "transition-colors duration-(--np-duration-fast) ease-spring-snappy hover:bg-(--np-hover-bg) active:bg-fill-tertiary focus-visible:outline-none focus-visible:[box-shadow:inset_var(--np-focus-halo)]",
    disabled && "pointer-events-none opacity-50",
    className
  )

  // The hairline: indented to the label's edge, past the icon when one is
  // present, and absent on the first row.
  const inset = icon
    ? "calc(var(--np-card-pad) + 1.25rem + 0.75rem)"
    : "var(--np-card-pad)"

  return (
    <li
      data-slot="grouped-list-item"
      data-tone={tone}
      style={{ "--gl-inset": inset } as React.CSSProperties}
      className="relative before:pointer-events-none before:absolute before:top-0 before:right-0 before:left-(--gl-inset) before:h-px before:bg-line-subtle before:content-[''] first:before:hidden"
    >
      {href ? (
        <Link
          href={href}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : undefined}
          className={rowClass}
          {...rest}
        >
          {content}
        </Link>
      ) : onClick ? (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={rowClass}
          {...rest}
        >
          {content}
        </button>
      ) : (
        <div className={rowClass} {...rest}>
          {content}
        </div>
      )}
    </li>
  )
}

export { GroupedList, GroupedListItem, type GroupedListItemProps }
