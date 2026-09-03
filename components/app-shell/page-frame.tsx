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
      className={cn(
        "mx-auto flex w-full flex-col gap-(--nr-gap-section) px-5 py-6 md:px-(--nr-page-pad-x) md:py-(--nr-page-pad-y)",
        width === "standard" && "max-w-(--nr-page-max-width)",
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

function PageHeader({
  title,
  description,
  eyebrow,
  meta,
  actions,
  tabs,
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
  /** A tab strip belonging to this page, rendered under the header. */
  tabs?: React.ReactNode
}) {
  return (
    <header className="flex shrink-0 flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? (
            <p className="text-caption font-medium text-ink-muted">{eyebrow}</p>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="font-display text-page-title tracking-tight text-balance">
              {title}
            </h1>
            {meta}
          </div>
          {description ? (
            <p className="max-w-2xl text-ui text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
      {tabs}
    </header>
  )
}

export { PageFrame, PageHeader }
