import { cn } from "@/lib/utils"

function Empty({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-(--nr-radius-card) border border-dashed border-border p-10 text-center",
        className
      )}
    >
      {children}
      <p className="text-title font-semibold">{title}</p>
      {description ? (
        <p className="max-w-sm text-ui text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  )
}

export { Empty }
