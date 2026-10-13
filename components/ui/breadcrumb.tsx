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
 * A desk presentation (spec "Shell and navigation"): breadcrumbs show in
 * the desk toolbar; a phone uses the app bar's labelled back control
 * ("‹ Listings") instead, because a trail of 24px links is neither
 * readable nor tappable at 360px. `deskOnly` hides the trail below `md`
 * in CSS, for a page that renders it inline while the shell provides the
 * back control.
 *
 * Deliberately a `nav > ol > li` of LINKS, with no heading of any kind: the
 * axe suite pins `heading-order` and `page-has-heading-one`, and a heading
 * here would land above the page's own `h1`.
 */
function Breadcrumbs({
  crumbs,
  className,
  deskOnly = false,
  ...props
}: React.ComponentProps<"nav"> & { crumbs: Crumb[]; deskOnly?: boolean }) {
  if (crumbs.length === 0) return null
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("min-w-0", deskOnly && "max-md:hidden", className)}
      {...props}
    >
      <ol className="flex min-w-0 items-center gap-1.5 text-ui">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <li
              key={`${crumb.label}-${index}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              {index > 0 ? (
                <span aria-hidden className="text-ink-faint">
                  /
                </span>
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
                  className="inline-flex min-h-6 items-center truncate rounded-(--np-radius-tag) whitespace-nowrap text-ink-muted focus-halo transition-colors duration-(--np-duration-fast) ease-spring-snappy hover:text-ink hover:underline hover:underline-offset-3"
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
