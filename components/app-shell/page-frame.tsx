import { cn } from "@/lib/utils"

/**
 * The four page widths.
 *
 * - `default` (alias `standard`, the name older callers use): 1080px, the
 *   reading width for forms, settings and single-subject pages.
 * - `wide`: 1440px, boards and tables that earn the room.
 * - `narrow`: 760px, one column of prose or one form.
 * - `workspace`: no max width. Where the window is at least 768 wide and
 *   620 tall it fills the height the shell's content column has left under
 *   the toolbar and any notices (flex, not a viewport calculation, so a
 *   banner can never push its pinned action row off the screen), and its
 *   panes scroll internally. Below that it scrolls with the page like any
 *   other: a phone scrolls the document.
 */
type PageWidth = "default" | "standard" | "wide" | "narrow" | "workspace"

/**
 * The page's width, gutters and vertical rhythm.
 *
 * A `div`, not the landmark: AppShell owns the one `<main id="main">`, so
 * the skip link has a target while a route is still streaming and no page
 * can render a second main.
 */
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
    <div
      data-slot="page-frame"
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
        width === "workspace" && "min-h-0 max-w-none flex-1 pb-6 md:pb-(--np-page-pad-y) md:[@media(min-height:620px)]:overflow-hidden",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * The page's title block, inside the content column.
 *
 * The toolbar above carries only the trail; the title lives here with its
 * actions so it scrolls with the page it names. One `h1` per page, and this
 * is it, set in the display role (`font-display`, which the type tokens point
 * at the system sans): the one large title that marks "where you are".
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
        <div className="flex min-w-0 grow basis-90 flex-col gap-1">
          {eyebrow ? <p className={EYEBROW_CLASS}>{eyebrow}</p> : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            {/* Focusable by script only: the shell moves focus here after a
                navigation (route-focus.tsx). */}
            <h1
              tabIndex={-1}
              className="font-display text-page-title font-semibold text-balance text-ink outline-none"
            >
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <p className="max-w-prose text-body text-pretty text-ink-muted">
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

/**
 * The quiet context line above a title (reference `.eyebrow`): sans, sentence
 * case, muted. Mono is kept for IDs and codes (D1), not for labels.
 */
const EYEBROW_CLASS = "text-caption font-medium text-ink-muted"

/**
 * A whole page that is one message: access denied, not found, an archived
 * record. Drawn like an empty state, not a card: an optional line glyph in
 * neutral ink, a short title, one muted sentence saying why, and the next
 * action, centred in the upper third of the page so it reads calm whether
 * the page worked or not. `tone` only colours the glyph, never a box.
 *
 * Renders NO landmark: inside the dashboard AppShell owns the single
 * `<main>`; a route file outside it (the root 404) supplies its own.
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
  /** The page's next action; one primary, any second one quiet. */
  action?: React.ReactNode
  /** A lucide glyph, drawn at 28px in line style above the title. */
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
      data-tone={tone}
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center gap-2 pt-10 pb-6 text-center md:pt-20",
        className
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "mb-2 flex items-center justify-center [&_svg]:size-7 [&_svg]:[stroke-width:1.5]",
            tone === "neutral" && "text-ink-secondary",
            tone === "warning" && "text-warning-ink",
            tone === "danger" && "text-danger-ink"
          )}
        >
          {icon}
        </span>
      ) : null}
      {eyebrow ? <p className={EYEBROW_CLASS}>{eyebrow}</p> : null}
      <h1
        tabIndex={-1}
        className="text-title font-medium text-balance text-ink outline-none"
      >
        {title}
      </h1>
      {description ? (
        <p className="text-ui text-pretty text-ink-muted">{description}</p>
      ) : null}
      {children}
      {action ? (
        <div className="mt-3 flex w-full flex-wrap items-center justify-center gap-2 @max-[480px]:*:flex-1">
          {action}
        </div>
      ) : null}
    </div>
  )
}

export { EYEBROW_CLASS, PageEmptyState, PageFrame, PageHeader, type PageWidth }
