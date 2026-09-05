import { ChevronRight } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

export type Crumb = {
  label: string
  /** Omitted on the current page, which is text rather than a link. */
  href?: string
}

/**
 * Wayfinding for the nested surfaces the agency IA introduces
 * (Clients › Client › Location › Section).
 *
 * Deliberately a `nav > ol > li` of LINKS, with no heading of any kind: the
 * axe suite pins `heading-order` and `page-has-heading-one`, and a heading
 * here would land above the page's own `h1`.
 */
function Breadcrumbs({
  crumbs,
  className,
  ...props
}: React.ComponentProps<"nav"> & { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)} {...props}>
      <ol className="flex min-w-0 items-center gap-1 text-ui">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <li
              key={`${crumb.label}-${index}`}
              className="flex min-w-0 items-center gap-1"
            >
              {index > 0 ? (
                <ChevronRight
                  aria-hidden
                  strokeWidth={1.75}
                  className="size-3.5 shrink-0 text-ink-faint"
                />
              ) : null}
              {isLast || !crumb.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-6 items-center truncate",
                    isLast ? "font-medium text-ink" : "text-ink-muted"
                  )}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="focus-halo inline-flex min-h-6 items-center truncate rounded-(--np-radius-tag) text-ink-muted transition-colors duration-(--np-duration-fast) ease-spring-snappy hover:text-ink"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export { Breadcrumbs }
