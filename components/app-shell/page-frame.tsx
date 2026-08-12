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
  actions,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="flex shrink-0 flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-page-title font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-ui text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

export { PageFrame, PageHeader }
