import { Empty } from "@/components/ui/empty"
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
          <div
            // The phone app bar watches this to know when the header's own
            // buttons have scrolled away (PageChrome `action`).
            data-slot="page-header-actions"
            className="flex flex-wrap items-center gap-2 @max-[480px]:w-full @max-[480px]:*:flex-1"
          >
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
 * record. Drawn by the shared empty state (`Empty`, components/ui/empty.tsx):
 * an optional glyph in its mark, the eyebrow, a short title, one muted
 * sentence saying why, and the next action. `placement="page"` (the default)
 * fills the page and sits the message at about 35% of its height, so it reads
 * calm whether the page worked or not; `inline` is for a message with more
 * of the page under it (AccessDenied's access details). `tone` only colours
 * the glyph's mark, never a box.
 *
 * The title is the page's one `h1`. Renders NO landmark: inside the
 * dashboard AppShell owns the single `<main>`; a route file outside it (the
 * root 404) supplies its own.
 */
function PageEmptyState({
  title,
  description,
  action,
  icon,
  eyebrow,
  tone = "neutral",
  placement = "page",
  children,
  className,
}: {
  title: string
  description?: React.ReactNode
  /** The page's next action; one primary, any second one quiet. */
  action?: React.ReactNode
  /** A lucide glyph, drawn in the empty state's mark above the title. */
  icon?: React.ReactNode
  /** e.g. "Page not found · 404". */
  eyebrow?: React.ReactNode
  tone?: "neutral" | "warning" | "danger"
  /** `page` (default): the message is the page. `inline`: more follows it. */
  placement?: "page" | "inline"
  /** Extra lines under the description (a requested path, an error id). */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <Empty
      data-slot="page-empty-state"
      data-tone={tone}
      placement={placement}
      titleAs={PAGE_TITLE_AS}
      icon={icon}
      tone={EMPTY_TONE[tone]}
      className={cn("mx-auto w-full max-w-md", className)}
      title={title}
      description={
        description || children ? (
          <>
            {description ? <p>{description}</p> : null}
            {children}
          </>
        ) : undefined
      }
      action={action}
    >
      {/* Empty draws its children between the glyph and the title. */}
      {eyebrow ? <p className={EYEBROW_CLASS}>{eyebrow}</p> : null}
    </Empty>
  )
}

const EMPTY_TONE = {
  neutral: "neutral",
  warning: "warn",
  danger: "bad",
} as const

/**
 * Empty's `titleAs` stops at h2 so an inline empty state never takes the
 * page's h1 by accident. This one IS the page, so its title is the h1 (the
 * one the shell's route focus lands on, route-focus.tsx). Empty renders the
 * element it is given; the cast only widens its type.
 */
const PAGE_TITLE_AS = "h1" as unknown as "h2"

export { EYEBROW_CLASS, PageEmptyState, PageFrame, PageHeader, type PageWidth }
