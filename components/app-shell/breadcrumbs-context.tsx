"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { breadcrumbTrail } from "@/lib/ui/breadcrumb-trail"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

/**
 * The toolbar's trail, derived from the path and the lists the shell already
 * holds.
 *
 * Deliberately NOT pushed up from each page: pages sit behind their own client
 * boundaries, so a context written deep in the tree and read here arrives a
 * render late at best, and not at all across some boundaries. Reading the URL
 * is the one source that is always right and always available.
 *
 * Slash-separated, the ancestors muted links and the current page in
 * semibold ink. Below 768px only the current page shows: the phone toolbar
 * also carries the health dot, search and the menu button, and the sheet's
 * navigation is the way back up.
 *
 * A `nav > ol > li` with no heading of any kind: the axe suite pins
 * `heading-order` and `page-has-heading-one`, and a heading here would land
 * above the page's own `h1`.
 */
function ShellBreadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname()
  const clients = useClients()
  const locations = useLocationDirectory(useSessionRole())

  const crumbs = breadcrumbTrail({
    pathname: pathname ?? "",
    clients: clients.data?.items ?? [],
    locations: locations.data ?? [],
  })

  if (crumbs.length === 0) return <div className={className} />

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-ui">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <li
              key={`${crumb.label}-${index}`}
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                !isLast && "shrink-0 max-md:hidden"
              )}
            >
              {index > 0 ? (
                <span aria-hidden className="text-line-strong max-md:hidden">
                  /
                </span>
              ) : null}
              {isLast || !crumb.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(
                    "truncate",
                    isLast ? "font-semibold text-ink" : "text-ink-muted"
                  )}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="max-w-[16rem] truncate rounded-sm text-ink-muted underline-offset-3 focus-halo hover:text-ink hover:underline focus-visible:outline-none"
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

export { ShellBreadcrumbs }
