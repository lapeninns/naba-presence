"use client"

import { useRender } from "@base-ui/react/use-render"
import { ChevronDownIcon } from "lucide-react"
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
 *              [Show details ▾]  (disclosure, outside the hit element)
 *              details region
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
 * - `flush`: for rows inside a padded section or drawer: no page-pad inset
 *   on either side, and a full-width hairline.
 * - `details` + `detailsLabel`: an expandable region under the row (a
 *   receipt, an outcome). Its disclosure button sits OUTSIDE the hit
 *   element, with `aria-expanded`/`aria-controls`; the button's words are
 *   entirely the caller's ("Show receipt for The Bell").
 * - `wrapperProps`: attributes for the outer `<li>`/`<div>` (`data-status`,
 *   `aria-busy`). Its `data-slot` replaces the default `"list-row"` (the
 *   inbox's `review-row-item`). `busy` marks the whole item `aria-busy`
 *   while it works (a notification being marked read), not only its row.
 * - `footer` is a block `<div>` under the text column, outside the hit
 *   element, so it may hold buttons, a `<form>`, a `<dl>` or a `<details>`.
 *   `footerLayout="stack"` stacks its children full width (a form, a
 *   definition list) instead of the default wrapping row of buttons.
 * - `titleAs="h2"|"h3"|"h4"`: the title is a real heading (name it with
 *   `titleId` for `aria-labelledby`). A heading is not phrasing content, so
 *   it may not sit inside a `<button>`, and a button's children are
 *   presentational to assistive tech anyway. Heading titles are therefore
 *   drawn on NON-INTERACTIVE rows (`interactive={false}`, the row carries
 *   its own controls) and on LINK rows (`href`: an `<a>` is transparent
 *   content, so `<a><div><h3>` is valid). The title's wrappers become
 *   `<div>`s so no `<span>` contains the heading. On a button row, a
 *   `render` row or inside `ListRows listbox` the heading is not drawn
 *   (a dev warning) and the title stays a plain span.
 * - `wrap`: the title and subtitle wrap (breaking long words such as email
 *   addresses anywhere) instead of truncating, so two long values never
 *   look identical.
 * - `ListRows listbox`: a selectable list. The `ul` is a `listbox`, each
 *   `li` is `presentation` and each row an `option` with `aria-selected`
 *   (rows default to `selectedAs="selected"`). Name it with `aria-label`.
 *   A listbox may only own options, so its rows take no `footer`,
 *   `details` or `leadingControl`. Outside `ListRows listbox`, use
 *   `selectedAs="selected"` only in a listbox or grid of your own.
 */

type Emphasis = "unread" | "read" | "neutral"

/**
 * Full bleed on a phone. PageFrame pads `px-5` below `md` (20px), while
 * `--np-page-pad-x` is 16px at 390, so a bleed by the token stopped 4px
 * short of each edge. The bleed cancels the frame's 20px instead, and the
 * rows inside pad by the same 20px (the page pad and the text inset that
 * derives from it are re-set here, because a custom property's `var()` is
 * resolved where it is declared, at the root), so the text column stays
 * where it was and the hover, selected fill and hairline reach the edges.
 */
const LIST_BLEED_CLASS =
  "max-md:-mx-5 max-md:[--np-page-pad-x:--spacing(5)] max-md:[--np-row-inset-start:calc(--spacing(5)+var(--np-avatar-list)+--spacing(3))]"

/** `null` outside `ListRows`; inside, whether the list is a listbox. */
const ListRowsContext = React.createContext<{ listbox: boolean } | null>(null)
const LIST_CONTEXT = { listbox: false }
const LISTBOX_CONTEXT = { listbox: true }

/**
 * A list of rows: a `<ul>` whose children render as `<li>`. `bleed` takes
 * the whole list to the screen edges on a phone. `listbox` makes it a
 * selectable listbox (see the ListRow notes above).
 */
function ListRows({
  bleed = false,
  listbox = false,
  className,
  onKeyDown,
  ...props
}: React.ComponentProps<"ul"> & {
  bleed?: boolean
  /**
   * `role="listbox"`; rows become options with `aria-selected`. The listbox
   * is one Tab stop (the selected option, else the first); Up/Down move,
   * Home/End jump, Enter or Space activates.
   */
  listbox?: boolean
}) {
  const ref = React.useRef<HTMLUListElement>(null)
  const optionsOf = (list: HTMLElement) =>
    Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'))

  // Every render: options come and go, and the selection moves with them.
  React.useLayoutEffect(() => {
    const list = ref.current
    if (!listbox || !list) return
    const options = optionsOf(list)
    const active = document.activeElement
    const stop =
      options.find((option) => option === active) ??
      options.find(
        (option) => option.getAttribute("aria-selected") === "true"
      ) ??
      options[0]
    for (const option of options) option.tabIndex = option === stop ? 0 : -1
  })

  return (
    <ListRowsContext.Provider value={listbox ? LISTBOX_CONTEXT : LIST_CONTEXT}>
      <ul
        ref={ref}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          const list = ref.current
          if (!listbox || !list || event.defaultPrevented) return
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return
          const options = optionsOf(list)
          const at = options.indexOf(document.activeElement as HTMLElement)
          if (at === -1 || options.length === 0) return
          event.preventDefault()
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? options.length - 1
                : Math.min(
                    options.length - 1,
                    Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1))
                  )
          for (const option of options) option.tabIndex = -1
          options[next]!.tabIndex = 0
          options[next]!.focus()
        }}
        role={listbox ? "listbox" : "list"}
        data-slot="list-rows"
        data-bleed={bleed || undefined}
        className={cn(
          "flex min-w-0 list-none flex-col",
          bleed && LIST_BLEED_CLASS,
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
  /**
   * For rows inside a padded section or drawer: no page-pad inset on
   * either side, and a full-width hairline.
   */
  flush?: boolean
  /**
   * Attributes for the outer `<li>`/`<div>` (e.g. `data-status`).
   * `wrapperClassName` still applies; `className` here is merged after it.
   */
  wrapperProps?: ListRowWrapperProps
  /**
   * `aria-busy` on the outer `<li>`/`<div>`: the whole item (row, footer
   * and details) is updating. Wins over `wrapperProps["aria-busy"]`.
   */
  busy?: boolean
  /**
   * An expandable region under the row (a receipt). Needs `detailsLabel`.
   * Rendered (hidden while closed) so `aria-controls` always resolves.
   */
  details?: React.ReactNode
  /**
   * The disclosure button's words, all the caller's ("Show receipt for The
   * Bell"); a function gets the open state for "Show…"/"Hide…".
   */
  detailsLabel?: React.ReactNode | ((open: boolean) => React.ReactNode)
  /** Controlled open state of `details`. */
  detailsOpen?: boolean
  /** Uncontrolled initial open state of `details`. */
  defaultDetailsOpen?: boolean
  onDetailsOpenChange?: (open: boolean) => void
  /**
   * `"row"` (default): the footer's children wrap in one row of buttons.
   * `"stack"`: a full-width column (a form, a `<dl>`, a `<details>`).
   */
  footerLayout?: "row" | "stack"
  /**
   * Draw the title as a real heading. Only on `interactive={false}` rows
   * and link (`href`) rows; see the notes above for why.
   */
  titleAs?: "span" | "h2" | "h3" | "h4"
  /** The title element's id (e.g. for a section's `aria-labelledby`). */
  titleId?: string
  /** Title and subtitle wrap instead of truncating. */
  wrap?: boolean
}

export type ListRowWrapperProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  "children"
> & {
  [data: `data-${string}`]: string | number | boolean | undefined
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
  selectedAs,
  bleed = false,
  href,
  interactive = true,
  wrapperClassName,
  footer,
  as,
  flush = false,
  wrapperProps,
  busy,
  details,
  detailsLabel,
  detailsOpen,
  defaultDetailsOpen = false,
  onDetailsOpenChange,
  footerLayout = "row",
  titleAs = "span",
  titleId,
  wrap = false,
  className,
  render,
  ...props
}: ListRowProps) {
  const list = React.useContext(ListRowsContext)
  const inListbox = list?.listbox ?? false
  const Wrapper = as ?? (list ? "li" : "div")
  if (
    inListbox &&
    (footer != null || details != null || leadingControl != null)
  ) {
    // A listbox may only own options: these slots are dropped there.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "ListRow: footer, details and leadingControl are not rendered inside ListRows listbox."
      )
    }
    footer = details = leadingControl = undefined
  }
  // A heading may only sit in a non-interactive row or a plain link row:
  // never inside a <button> (or an unknown `render` element) or an option.
  const headingAllowed =
    !inListbox && render === undefined && (!interactive || href !== undefined)
  if (titleAs !== "span" && !headingAllowed) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `ListRow: titleAs="${titleAs}" needs interactive={false} or href (a heading cannot sit inside a button or an option); the title is drawn as a span.`
      )
    }
  }
  const TitleTag = headingAllowed ? titleAs : "span"
  const titleIsHeading = TitleTag !== "span"
  // No <span> may contain the heading: its wrappers become <div>s.
  const TitleBox = titleIsHeading ? "div" : "span"
  const hasFooter = footer != null && footer !== false
  const hasDetails = details != null && details !== false
  const hasLeading = leading != null || leadingControl != null
  const isLink = href !== undefined
  const detailsId = React.useId()
  const [uncontrolledOpen, setUncontrolledOpen] =
    React.useState(defaultDetailsOpen)
  const open = detailsOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (detailsOpen === undefined) setUncontrolledOpen(next)
    onDetailsOpenChange?.(next)
  }
  const announceAs = selectedAs ?? (inListbox ? "selected" : "current")
  // The text column's start, for the footer and details: past the leading
  // column when there is one.
  const textStart = flush
    ? hasLeading
      ? "ps-[calc(var(--np-avatar-list)+--spacing(3))]"
      : "ps-0"
    : hasLeading
      ? "ps-(--np-row-inset-start)"
      : "ps-(--np-page-pad-x)"
  const textEnd = flush ? "pe-0" : "pe-(--np-page-pad-x)"

  const selectionProps: Record<string, string | boolean | undefined> = {}
  if (interactive) {
    if (announceAs === "selected") {
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
      <TitleBox
        data-slot="list-row-body"
        className="flex min-w-0 flex-1 flex-col"
      >
        <TitleBox className="flex min-w-0 items-baseline gap-2">
          <TitleBox className="flex min-w-0 flex-1 items-center gap-1.5">
            <TitleTag
              id={titleId}
              data-slot="list-row-title"
              data-wrap={wrap || undefined}
              className={cn(
                "min-w-0 text-body",
                wrap ? "wrap-anywhere" : "truncate",
                TITLE_CLASS[emphasis]
              )}
            >
              {title}
            </TitleTag>
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
          </TitleBox>
          {meta != null ? (
            <span
              data-slot="list-row-meta"
              className="shrink-0 text-caption whitespace-nowrap text-ink-muted tabular-nums"
            >
              {meta}
            </span>
          ) : null}
        </TitleBox>
        {subtitle != null || trailing != null ? (
          <span className="flex min-w-0 items-center gap-2">
            <span
              data-slot="list-row-subtitle"
              className={cn(
                "min-w-0 flex-1 text-ui",
                wrap ? "wrap-anywhere" : "truncate",
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
      </TitleBox>
    </>
  )

  const hitClassName = cn(
    "flex min-h-(--np-touch) w-full min-w-0 items-start gap-3 py-(--np-row-mail-py) text-left text-ink no-underline",
    flush ? "px-0" : "px-(--np-page-pad-x)",
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

  const label =
    typeof detailsLabel === "function" ? detailsLabel(open) : detailsLabel

  return (
    <Wrapper
      {...wrapperProps}
      role={inListbox && Wrapper === "li" ? "presentation" : wrapperProps?.role}
      aria-busy={busy ?? wrapperProps?.["aria-busy"]}
      data-slot={wrapperProps?.["data-slot"] ?? "list-row"}
      data-selected={selected || undefined}
      data-bleed={bleed || undefined}
      data-flush={flush || undefined}
      className={cn(
        "relative flex min-w-0 flex-col",
        // The divider: under the text column only (full width when flush),
        // never under the last row or the selected one.
        "after:pointer-events-none after:absolute after:bottom-0 after:h-px after:bg-line-subtle after:content-['']",
        flush
          ? "after:inset-x-0"
          : cn(
              "after:end-(--np-page-pad-x)",
              hasLeading
                ? "after:start-(--np-row-inset-start)"
                : "after:start-(--np-page-pad-x)"
            ),
        "last:after:hidden data-selected:after:hidden",
        bleed && LIST_BLEED_CLASS,
        wrapperClassName,
        wrapperProps?.className
      )}
    >
      {leadingControl != null ? (
        // The control's own target, outside the row's hit element. On touch
        // an `after:` overhang takes the wrapper to 44px, and a press on
        // the wrapper (not on the control) is passed to the control, so the
        // overhang over the row selects rather than opening the row.
        <span
          data-slot="list-row-control"
          onClick={(event) => {
            if (event.target !== event.currentTarget) return
            event.currentTarget
              .querySelector<HTMLElement>(LEADING_CONTROL_SELECTOR)
              ?.click()
          }}
          className={cn(
            "absolute top-(--np-row-mail-py) z-raised grid size-(--np-avatar-list) place-items-center",
            flush ? "start-0" : "start-(--np-page-pad-x)",
            "after:absolute after:inset-[calc((100%-var(--np-touch))/2)] after:content-[''] desk:after:hidden"
          )}
        >
          {leadingControl}
        </span>
      ) : null}
      {hit}
      {hasFooter ? (
        <div
          data-slot="list-row-footer"
          data-layout={footerLayout}
          className={cn(
            "-mt-1 flex min-w-0 gap-2 pb-(--np-row-mail-py)",
            footerLayout === "stack"
              ? "flex-col items-stretch"
              : "flex-wrap items-center",
            textStart,
            textEnd
          )}
        >
          {footer}
        </div>
      ) : null}
      {hasDetails ? (
        <>
          <div
            data-slot="list-row-disclosure"
            className={cn(
              "flex min-w-0",
              textStart,
              textEnd,
              hasFooter ? "-mt-1" : "-mt-2",
              !open && "pb-1"
            )}
          >
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailsId}
              data-slot="list-row-details-toggle"
              onClick={() => setOpen(!open)}
              className="group/disclosure -ms-2 inline-flex min-h-(--np-touch) items-center gap-1 rounded-(--np-radius-control) px-2 text-start text-ui font-medium text-accent-ink focus-halo hover-fine:hover:bg-fill desk:min-h-8"
            >
              {label}
              <ChevronDownIcon
                aria-hidden
                strokeWidth={1.75}
                className="size-4 shrink-0 transition-transform duration-(--np-duration-fast) ease-standard group-aria-expanded/disclosure:rotate-180 motion-reduce:transition-none"
              />
            </button>
          </div>
          <div
            id={detailsId}
            data-slot="list-row-details"
            hidden={!open}
            className={cn("min-w-0 pb-(--np-row-mail-py)", textStart, textEnd)}
          >
            {details}
          </div>
        </>
      ) : null}
    </Wrapper>
  )
}

/** What a press on the leading control's overhang is passed on to. */
const LEADING_CONTROL_SELECTOR =
  'button, input, a[href], [role="checkbox"], [role="switch"], [role="radio"]'

const TAG_TONES = {
  neutral: "bg-tag-neutral-bg text-tag-neutral-ink",
  blue: "bg-tag-blue-bg text-tag-blue-ink",
  pink: "bg-tag-pink-bg text-tag-pink-ink",
  orange: "bg-tag-orange-bg text-tag-orange-ink",
  purple: "bg-tag-purple-bg text-tag-purple-ink",
  green: "bg-tag-green-bg text-tag-green-ink",
  // A label over a photo ("Logo", "Customer"): an opaque surface chip in
  // full ink, lifted off the image by the raised shadow (ink on surface is
  // a gated pair, whatever the photo underneath).
  "on-image": "bg-surface text-ink shadow-np-raised",
  // An emphasised label (the accent-ink on accent-tint pair of the active
  // chip). Not a status: status words use StatusPill.
  accent: "bg-accent-tint text-accent-ink",
} as const

export type ListRowTagTone = keyof typeof TAG_TONES

/**
 * A user tag in a row (review tags, AI topics, post type). Decorative tag
 * ramp only: status hues are reserved for status pills. `on-image` is for a
 * label laid over a photo; `accent` for an emphasised label.
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

export { LIST_BLEED_CLASS, ListRow, ListRowTag, ListRows }
