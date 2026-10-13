"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { backTarget, type BackTarget } from "@/lib/navigation/back-target"
import { breadcrumbTrail } from "@/lib/ui/breadcrumb-trail"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

import { usePageChromeOverride } from "./page-chrome"

/**
 * The trail for the current path, derived from the path and the lists the
 * shell already holds.
 *
 * Deliberately NOT pushed up from each page: pages sit behind their own client
 * boundaries, so a context written deep in the tree and read here arrives a
 * render late at best, and not at all across some boundaries. Reading the URL
 * is the one source that is always right and always available.
 */
function useShellTrail() {
  const pathname = usePathname()
  const clients = useClients()
  const locations = useLocationDirectory(useSessionRole())
  const mode = useWorkspaceMode()
  return breadcrumbTrail({
    pathname: pathname ?? "",
    clients: clients.data?.items ?? [],
    locations: locations.data ?? [],
    mode,
  })
}

/**
 * Where the back control goes: the page's own override when it declared
 * one (`<PageChrome back>`), otherwise the trail's parent. Null on a
 * top-level page.
 */
function useShellBack(): BackTarget | null {
  const pathname = usePathname()
  const trail = useShellTrail()
  const override = usePageChromeOverride()
  if (override.back !== undefined) return override.back
  return backTarget(pathname, trail)
}

/**
 * The desk toolbar's trail, from 1180px (`wide`). Narrower screens show the
 * labelled back control instead: at 768 every crumb truncated to a few
 * letters and repeated the eyebrow and the h1 below it.
 *
 * Slash-separated, the ancestors muted links and the current page in
 * semibold ink.
 *
 * A `nav > ol > li` with no heading of any kind: the axe suite pins
 * `heading-order` and `page-has-heading-one`, and a heading here would land
 * above the page's own `h1`.
 */
function ShellBreadcrumbs({ className }: { className?: string }) {
  const crumbs = useShellTrail()

  if (crumbs.length === 0) return <div className={className} />

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex max-w-full min-w-0 items-center gap-1.5 text-ui">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <li
              key={`${crumb.label}-${index}`}
              data-slot={isLast ? "breadcrumb-current" : "breadcrumb-ancestor"}
              // Every crumb may shrink, so the trail never overflows its nav:
              // it shares the strip with the switcher and the health pill,
              // and ancestors that refused to shrink pushed the current page
              // out of the nav and under the pill. The ancestors give
              // way first (a far larger shrink weight), each truncating with
              // an ellipsis; the current crumb truncates only once they are
              // spent, and its full name stays in `title`.
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                isLast ? "shrink" : "shrink-[100]"
              )}
            >
              {index > 0 ? (
                <span aria-hidden className="shrink-0 text-line-strong">
                  /
                </span>
              ) : null}
              {isLast || !crumb.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  title={crumb.label}
                  className={cn(
                    "min-w-0 truncate",
                    isLast ? "font-semibold text-ink" : "text-ink-muted"
                  )}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  title={crumb.label}
                  className="max-w-[16rem] min-w-0 truncate rounded-sm text-ink-muted underline-offset-3 focus-halo hover:text-ink hover:underline focus-visible:outline-none"
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

export { ShellBreadcrumbs, useShellBack, useShellTrail }
