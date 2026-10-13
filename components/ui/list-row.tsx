"use client"

import { useRender } from "@base-ui/react/use-render"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The list row (Notion Mail's mail row, brief §4.3): one primitive for
 * review rows, notification rows, post rows and approval queues.
 *
 *   [leading]  title · dot              meta
 *              subtitle                 trailing
 *              preview (2 lines touch, 1 desk)
 *              tags
 *              footer (actions, outside the hit element)
 *
 * - The WHOLE row is the hit target (a button, a link via `href`, or any
 *   element via `render`), at least `--np-touch` tall, padded by
 *   `--np-row-mail-py`. `interactive={false}` draws the same row as a plain
 *   box for rows that carry their own controls.
 * - `leadingControl` (a selection checkbox) sits over the leading column
 *   OUTSIDE the hit element, so it stays a separate control with its own
 *   44px target while the rest of the row remains one target.
 * - `emphasis="unread"`: title 600 ink, a 6px `indicator-unread` dot after
 *   it and a matching sr-only word (`unreadLabel`, "Unread"): the dot only
 *   reinforces words. `"read"`: title 400 ink-secondary. `"neutral"`: for
 *   lists without a read state, title 500 ink.
 * - Selected: `bg-fill`, `aria-current` (or `aria-selected` with
 *   `selectedAs="selected"` inside a listbox/grid), and no divider.
 * - Divider: 1px `line-subtle`, inset from `--np-row-inset-start` (the text
 *   column) to `--np-page-pad-x`; never under the last row.
 * - Focus: an inset 2px ring (a box-shadow, so a scrolling list never clips
 *   it; `outline-hidden` keeps an outline in forced colours). Hover
 *   `surface-alt`, fine pointers only.
 * - `bleed`: on a phone the row (or the `ListRows` list) cancels the page
 *   frame's padding and runs edge to edge; its own padding is the page's.
 */

type Emphasis = "unread" | "read" | "neutral"

const ListRowsContext = React.createContext(false)

/**
 * A list of rows: a `<ul>` whose children render as `<li>`. `bleed` takes
 * the whole list to the screen edges on a phone.
 */
function ListRows({
  bleed = false,
  className,
  ...props
}: React.ComponentProps<"ul"> & { bleed?: boolean }) {
  return (
    <ListRowsContext.Provider value>
      <ul
        role="list"
        data-slot="list-rows"
        data-bleed={bleed || undefined}
        className={cn(
          "flex min-w-0 list-none flex-col",
          bleed && "max-md:-mx-(--np-page-pad-x)",
          className
        )}
        {...props}
      />
    </ListRowsContext.Provider>
  )
}

const TITLE_CLASS: Record<Emphasis, string> = {
  unread: "font-semibold text-ink",
  read: "font-normal text-ink-secondary",
  neutral: "font-medium text-ink",
}

export type ListRowProps = Omit<
  useRender.ComponentProps<"button">,
  "title" | "children"
> & {
  /** Avatar, icon or check, drawn in a `--np-avatar-list` column. */
  leading?: React.ReactNode
  /**
   * An interactive control for the leading column (a selection checkbox).
   * Rendered outside the row's hit element so it is its own control.
   */
  leadingControl?: React.ReactNode
  title: React.ReactNode
  /** Trailing L1 text: the time. Sans caption with tabular figures. */
  meta?: React.ReactNode
  /** L2: e.g. stars and client · location. Truncates. */
  subtitle?: React.ReactNode
  /** Trailing L2: a status pill. Shares the line with `subtitle`. */
  trailing?: React.ReactNode
  /** The snippet: 2 lines on touch, 1 on a desk (1 when tags are shown). */
  preview?: React.ReactNode
  /** Tag pills (`ListRowTag`), the last line. */
  tags?: React.ReactNode
  emphasis?: Emphasis
  /** The sr-only word that the unread dot reinforces. */
  unreadLabel?: string
  selected?: boolean
  /**
   * How selection is announced: `aria-current` (default; "page" for a
   * link) or `aria-selected` (inside a listbox or grid).
   */
  selectedAs?: "current" | "selected"
  /** Full-bleed on a phone (cancels the page frame padding). */
  bleed?: boolean
  /** Renders the row as a Next link. */
  href?: string
  /** `false`: a plain box for rows that contain their own controls. */
  interactive?: boolean
  /** Classes for the outer `<li>`/`<div>` that draws the divider. */
  wrapperClassName?: string
  /**
   * Actions under the preview (Accept / Ignore, Approve / Reject). Drawn
   * OUTSIDE the row's hit element, aligned to the text column, so its
   * buttons are valid HTML and separate tab stops.
   */
  footer?: React.ReactNode
  /**
   * The outer element. Defaults to `li` inside `ListRows`, `div` elsewhere;
   * pass `"li"` when the row sits in a list of your own.
   */
  as?: "li" | "div"
}

function ListRow({
  leading,
  leadingControl,
  title,
  meta,
  subtitle,
  trailing,
  preview,
  tags,
  emphasis = "read",
  unreadLabel = "Unread",
  selected = false,
  selectedAs = "current",
  bleed = false,
  href,
  interactive = true,
  wrapperClassName,
  footer,
  as,
  className,
  render,
  ...props
}: ListRowProps) {
  const inList = React.useContext(ListRowsContext)
  const Wrapper = as ?? (inList ? "li" : "div")
  const hasFooter = footer != null && footer !== false
  const hasLeading = leading != null || leadingControl != null
  const isLink = href !== undefined

  const selectionProps: Record<string, string | boolean | undefined> = {}
  if (interactive) {
    if (selectedAs === "selected") {
      // aria-selected is only valid on an option-like role.
      if (props.role === undefined) selectionProps.role = "option"
      selectionProps["aria-selected"] = selected
    } else if (selected)
      selectionProps["aria-current"] = isLink ? "page" : "true"
  }

  const content = (
    <>
      {hasLeading ? (
        <span
          data-slot="list-row-leading"
          aria-hidden={
            leadingControl != null && leading == null ? true : undefined
          }
          className="grid size-(--np-avatar-list) shrink-0 place-items-center"
        >
          {leading}
        </span>
      ) : null}
      <span data-slot="list-row-body" className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              data-slot="list-row-title"
              className={cn(
                "min-w-0 truncate text-body",
                TITLE_CLASS[emphasis]
              )}
            >
              {title}
            </span>
            {emphasis === "unread" ? (
              <>
                <span
                  aria-hidden
                  data-slot="list-row-unread-dot"
                  className="size-1.5 shrink-0 rounded-full bg-indicator-unread"
                />
                <span className="sr-only">, {unreadLabel}</span>
              </>
            ) : null}
          </span>
          {meta != null ? (
            <span
              data-slot="list-row-meta"
              className="shrink-0 text-caption whitespace-nowrap text-ink-muted tabular-nums"
            >
              {meta}
            </span>
          ) : null}
        </span>
        {subtitle != null || trailing != null ? (
          <span className="flex min-w-0 items-center gap-2">
            <span
              data-slot="list-row-subtitle"
              className={cn(
                "min-w-0 flex-1 truncate text-ui",
                emphasis === "read" ? "text-ink-secondary" : "text-ink"
              )}
            >
              {subtitle}
            </span>
            {trailing != null ? (
              <span
                data-slot="list-row-trailing"
                className="flex shrink-0 items-center gap-1.5"
              >
                {trailing}
              </span>
            ) : null}
          </span>
        ) : null}
        {preview != null ? (
          <span
            data-slot="list-row-preview"
            className={cn(
              "min-w-0 text-ui text-ink-secondary",
              tags != null ? "line-clamp-1" : "line-clamp-2 desk:line-clamp-1"
            )}
          >
            {preview}
          </span>
        ) : null}
        {tags != null ? (
          <span
            data-slot="list-row-tags"
            className="mt-1 flex min-w-0 flex-wrap gap-1.5"
          >
            {tags}
          </span>
        ) : null}
      </span>
    </>
  )

  const hitClassName = cn(
    "flex min-h-(--np-touch) w-full min-w-0 items-start gap-3 px-(--np-page-pad-x) py-(--np-row-mail-py) text-left text-ink no-underline",
    interactive &&
      "cursor-pointer transition-colors duration-(--np-duration-fast) ease-spring-snappy outline-none focus-visible:ring-2 focus-visible:ring-(--np-focus-ring) focus-visible:ring-inset forced-colors:focus-visible:outline-2 forced-colors:focus-visible:-outline-offset-2 hover-fine:hover:bg-surface-alt",
    selected && "bg-fill hover-fine:hover:bg-fill",
    className
  )

  const hit = useRender({
    defaultTagName: interactive ? "button" : "div",
    render:
      render ?? (interactive && isLink ? <Link href={href} /> : undefined),
    props: {
      ...(interactive && !isLink && !render ? { type: "button" as const } : {}),
      ...selectionProps,
      ...props,
      "data-slot": "list-row-hit",
      "data-emphasis": emphasis,
      "data-selected": selected || undefined,
      className: hitClassName,
      children: content,
    },
  })

  return (
    <Wrapper
      data-slot="list-row"
      data-selected={selected || undefined}
      data-bleed={bleed || undefined}
      className={cn(
        "relative flex min-w-0 flex-col",
        // The divider: under the text column only, never under the last row
        // or the selected one.
        "after:pointer-events-none after:absolute after:end-(--np-page-pad-x) after:bottom-0 after:h-px after:bg-line-subtle after:content-['']",
        hasLeading
          ? "after:start-(--np-row-inset-start)"
          : "after:start-(--np-page-pad-x)",
        "last:after:hidden data-selected:after:hidden",
        bleed && "max-md:-mx-(--np-page-pad-x)",
        wrapperClassName
      )}
    >
      {leadingControl != null ? (
        <span
          data-slot="list-row-control"
          className="absolute start-(--np-page-pad-x) top-(--np-row-mail-py) z-raised grid size-(--np-avatar-list) place-items-center"
        >
          {leadingControl}
        </span>
      ) : null}
      {hit}
      {hasFooter ? (
        <div
          data-slot="list-row-footer"
          className={cn(
            "-mt-1 flex min-w-0 flex-wrap items-center gap-2 pe-(--np-page-pad-x) pb-(--np-row-mail-py)",
            hasLeading ? "ps-(--np-row-inset-start)" : "ps-(--np-page-pad-x)"
          )}
        >
          {footer}
        </div>
      ) : null}
    </Wrapper>
  )
}

const TAG_TONES = {
  neutral: "bg-tag-neutral-bg text-tag-neutral-ink",
  blue: "bg-tag-blue-bg text-tag-blue-ink",
  pink: "bg-tag-pink-bg text-tag-pink-ink",
  orange: "bg-tag-orange-bg text-tag-orange-ink",
  purple: "bg-tag-purple-bg text-tag-purple-ink",
  green: "bg-tag-green-bg text-tag-green-ink",
} as const

export type ListRowTagTone = keyof typeof TAG_TONES

/**
 * A user tag in a row (review tags, AI topics, post type). Decorative tag
 * ramp only: status hues are reserved for status pills.
 */
function ListRowTag({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: ListRowTagTone }) {
  return (
    <span
      data-slot="list-row-tag"
      data-tone={tone}
      className={cn(
        "inline-flex h-(--np-chip-h) max-w-full items-center rounded-(--np-radius-tag) px-2 text-caption whitespace-nowrap",
        TAG_TONES[tone],
        className
      )}
      {...props}
    />
  )
}

export { ListRow, ListRowTag, ListRows }
