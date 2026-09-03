import { Store } from "lucide-react"

import { cn } from "@/lib/utils"

function BrandMark({
  size = "sm",
  subtitle,
}: {
  size?: "sm" | "lg"
  subtitle?: React.ReactNode
}) {
  const large = size === "lg"

  return (
    <div
      className={cn("flex min-w-0 items-center", large ? "gap-3" : "gap-2.5")}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-(--nr-radius-control) bg-primary text-primary-foreground",
          large ? "size-10" : "size-8"
        )}
      >
        <Store className={large ? "size-5" : "size-4"} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col">
        <span
          className={cn(
            "truncate font-semibold tracking-tight",
            large ? "text-page-title" : "text-title"
          )}
        >
          NabaPresence
        </span>
        {subtitle ? (
          <span className="truncate text-caption font-medium text-sidebar-foreground/70">
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export { BrandMark }
