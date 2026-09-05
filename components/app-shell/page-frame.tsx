import { cn } from "@/lib/utils"

function PageFrame({
  width = "standard",
  className,
  children,
}: {
  width?: "standard" | "wide" | "workspace"
  className?: string
  children: React.ReactNode
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      // The width strings are pinned verbatim by tests/design-system-contract
      // and the class sorter would reorder the workspace one, so this
      // attribute is left as written.
      // prettier-ignore
      className={cn(
        "mx-auto flex w-full flex-col gap-(--np-gap-section) px-5 py-6 outline-none md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)",
        width === "standard" && "max-w-(--np-page-max-width)",
        width === "wide" && "max-w-7xl",
        // Fill the shell's content box and keep overflow inside child panes
        // (inbox split, location workspace) so expanding panels don't stretch
        // the nav sidebar.
        width === "workspace" && "h-full max-w-none min-h-0 overflow-hidden",
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
 * is it: hierarchy is weight and tracking (the page-title role is bold and
 * tight), never a second typeface.
 *
 * `actions` are laid out right-aligned in the order given; put the primary
 * action LAST so it sits at the trailing edge, where the platform puts it.
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
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? (
            <p className="text-caption font-medium text-ink-muted">{eyebrow}</p>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="text-page-title font-bold text-balance text-ink">
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <p className="max-w-2xl text-ui text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {tabs}
    </header>
  )
}

/**
 * A whole page that is one message: access denied, not found, an error
 * boundary. Centred, a title that is the page's `h1`, one sentence and one
 * action. The `Empty` primitive draws the same shape for a region inside a
 * page, but its title is a paragraph; a page needs its heading, so this
 * carries the `h1` itself.
 *
 * Renders NO landmark. The route or layout that owns the page's single
 * `<main>` wraps it (`PageFrame`, or the route file's own `main`).
 */
function PageEmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description?: React.ReactNode
  /** One clear action, a verb. */
  action?: React.ReactNode
  /** A lucide glyph; rendered in a grey disc above the title. */
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="page-empty-state"
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center gap-2 py-16 text-center",
        className
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className="mb-2 flex size-10 items-center justify-center rounded-full bg-fill-secondary text-ink-muted [&_svg]:size-5"
        >
          {icon}
        </span>
      ) : null}
      <h1 className="text-title font-semibold text-balance text-ink">
        {title}
      </h1>
      {description ? (
        <p className="text-ui text-pretty text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export { PageEmptyState, PageFrame, PageHeader }
