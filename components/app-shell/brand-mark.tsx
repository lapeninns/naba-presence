import { Store } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The product glyph beside a name.
 *
 * In the sidebar the name is the organisation's — the person sitting in the
 * tool all day is an agency, and a Mac sidebar leads with the workspace, not
 * the vendor — so `title` is overridable and the product becomes the caption.
 * The auth screens keep the default and show the product.
 */
function BrandMark({
  size = "sm",
  title = "NabaPresence",
  subtitle,
}: {
  size?: "sm" | "lg"
  /** The primary line. Defaults to the product name. */
  title?: React.ReactNode
  subtitle?: React.ReactNode
}) {
  const large = size === "lg"

  return (
    <div
      className={cn("flex min-w-0 items-center", large ? "gap-3" : "gap-2.5")}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center bg-primary text-primary-foreground",
          large
            ? "size-10 rounded-(--np-radius-control)"
            : "size-7 rounded-[calc(var(--np-radius-control)-2px)]"
        )}
      >
        <Store
          className={large ? "size-5" : "size-4"}
          strokeWidth={1.75}
          aria-hidden
        />
      </span>
      <div className="flex min-w-0 flex-col">
        <span
          className={cn(
            "truncate text-ink",
            large ? "text-page-title font-bold" : "text-ui font-semibold"
          )}
        >
          {title}
        </span>
        {subtitle ? (
          <span className="truncate text-caption font-medium text-ink-muted">
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export { BrandMark }
