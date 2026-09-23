import { cn } from "@/lib/utils"

/**
 * The four page widths.
 *
 * - `default` (alias `standard`, the name older callers use): 1080px, the
 *   reading width for forms, settings and single-subject pages.
 * - `wide`: 1440px, boards and tables that earn the room.
 * - `narrow`: 760px, one column of prose or one form.
 * - `workspace`: no max width. Where the window is at least 768 wide and
 *   620 tall it is locked to the viewport under the toolbar, so its panes
 *   scroll internally and a pinned action row never leaves the screen.
 *   Below that it scrolls with the column like any other page.
 */
type PageWidth = "default" | "standard" | "wide" | "narrow" | "workspace"

function PageFrame({
  width = "default",
  className,
  children,
}: {
  width?: PageWidth
  className?: string
  children: React.ReactNode
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      data-width={width}
      // Phones keep the 20px/24px gutters page sections already bleed
      // against (`-mx-5`, `-mb-6`); from 768px the gutters are fluid.
      // `@container` makes the page the inline-size container its sections
      // query, so a card grid answers to the room the page actually has
      // (sidebar, rail or sheet) rather than to the viewport.
      // prettier-ignore
      className={cn(
        "@container mx-auto flex w-full flex-col gap-(--np-gap-section) px-5 pt-6 pb-12 outline-none md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y) md:pb-[calc(var(--np-page-pad-y)+24px)]",
        (width === "default" || width === "standard") && "max-w-(--np-page-default-width)",
        width === "wide" && "max-w-(--np-page-max-width)",
        width === "narrow" && "max-w-(--np-page-narrow-width)",
        width === "workspace" && "min-h-0 max-w-none flex-1 pb-6 md:pb-(--np-page-pad-y) md:[@media(min-height:620px)]:h-[calc(100svh-var(--np-toolbar-h))] md:[@media(min-height:620px)]:flex-none md:[@media(min-height:620px)]:overflow-hidden",
        className
      )}
    >
      {children}
    </main>
  )
}

/**
 * The page's title block, inside the content column.
 *
 * The toolbar above carries only the trail; the title lives here with its
 * actions so it scrolls with the page it names. One `h1` per page, and this
 * is it, set in the display serif: the serif is kept for page titles and the
 * customer's own words, so it always marks "where you are".
 *
 * `actions` are laid out right-aligned in the order given; put the primary
 * action LAST so it sits at the trailing edge. On a narrow page they take the
 * full width and share it.
 */
function PageHeader({
  title,
  description,
  eyebrow,
  meta,
  actions,
  tabs,
  className,
}: {
  title: string
  description?: React.ReactNode
  /**
   * A line above the title naming the wider context, e.g. the client a
   * location belongs to. Rendered as a `p`, never a heading: the page's h1 is
   * the title, and a heading here would land above it.
   */
  eyebrow?: React.ReactNode
  /** Status pills and counts that sit beside the title. */
  meta?: React.ReactNode
  actions?: React.ReactNode
  /**
   * A segmented control or tab strip belonging to this page, rendered under
   * the header.
   */
  tabs?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn("flex shrink-0 flex-col gap-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-[1_1_22.5rem] flex-col gap-1.5">
          {eyebrow ? <p className={EYEBROW_CLASS}>{eyebrow}</p> : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="font-display text-page-title font-semibold text-balance text-ink">
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <p className="max-w-[70ch] text-body text-pretty text-ink-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 @max-[480px]:w-full @max-[480px]:*:flex-1">
            {actions}
          </div>
        ) : null}
      </div>
      {tabs}
    </header>
  )
}

/** The mono, upper-case context line above a title (reference `.eyebrow`). */
const EYEBROW_CLASS =
  "font-mono text-[0.71875rem] leading-4 font-medium tracking-[0.06em] text-ink-muted uppercase"

/**
 * A whole page that is one message: access denied, not found, an error
 * boundary. A tinted mark, the mono eyebrow, a serif `h1`, one sentence and
 * its actions, left-aligned like every other page header so the shell reads
 * the same whether the page worked or not.
 *
 * Renders NO landmark. The route or layout that owns the page's single
 * `<main>` wraps it (`PageFrame`, or the route file's own `main`).
 */
function PageEmptyState({
  title,
  description,
  action,
  icon,
  eyebrow,
  tone = "neutral",
  children,
  className,
}: {
  title: string
  description?: React.ReactNode
  /** The page's actions, primary first. */
  action?: React.ReactNode
  /** A lucide glyph, drawn in a 44px tinted square above the title. */
  icon?: React.ReactNode
  /** e.g. "Page not found · 404". */
  eyebrow?: React.ReactNode
  tone?: "neutral" | "warning" | "danger"
  /** Extra lines under the description (a requested path, an error id). */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="page-empty-state"
      className={cn(
        "flex flex-wrap items-end justify-between gap-4",
        className
      )}
    >
      <div className="flex min-w-0 flex-[1_1_22.5rem] flex-col gap-1.5">
        {icon ? (
          <span
            aria-hidden
            className={cn(
              "mb-1.5 flex size-11 items-center justify-center rounded-lg [&_svg]:size-5",
              tone === "neutral" && "bg-fill text-ink-secondary",
              tone === "warning" && "bg-warning-tint text-warning-ink",
              tone === "danger" && "bg-danger-tint text-danger-ink"
            )}
          >
            {icon}
          </span>
        ) : null}
        {eyebrow ? <p className={EYEBROW_CLASS}>{eyebrow}</p> : null}
        <h1
          tabIndex={-1}
          className="font-display text-page-title font-semibold text-balance text-ink outline-none"
        >
          {title}
        </h1>
        {description ? (
          <p className="max-w-[70ch] text-body text-pretty text-ink-muted">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {action ? (
        <div className="flex flex-wrap items-center gap-2 @max-[480px]:w-full @max-[480px]:*:flex-1">
          {action}
        </div>
      ) : null}
    </div>
  )
}

export { EYEBROW_CLASS, PageEmptyState, PageFrame, PageHeader, type PageWidth }
