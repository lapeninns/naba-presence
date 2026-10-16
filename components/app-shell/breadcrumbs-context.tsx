"use client"

import { usePathname } from "next/navigation"

import { backTarget, type BackTarget } from "@/lib/navigation/back-target"
import { SETTINGS_SECTION_LABELS } from "@/lib/settings/areas"
import type { Crumb } from "@/components/ui/breadcrumb"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { breadcrumbTrail, foldTrail } from "@/lib/ui/breadcrumb-trail"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

import { usePageChromeOverride } from "./page-chrome"
import { ShellLink } from "./shell-link"

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
  const mode = useWorkspaceMode()
  const override = usePageChromeOverride()
  if (override.back !== undefined) return override.back
  return backTarget(pathname, trail, mode)
}

/**
 * The trail the desk toolbar draws. On a desk /settings is Reply policy under
 * the settings tabs (app/(dashboard)/settings/page.tsx), so it reads
 * "Settings / Reply policy" like every other tab; the shared trail stays
 * "Settings" because on a phone /settings is the index of areas.
 */
function deskTrail(pathname: string | null, trail: Crumb[]): Crumb[] {
  if (pathname !== "/settings" || !SETTINGS_SECTION_LABELS.policy) return trail
  return [...trail, { label: SETTINGS_SECTION_LABELS.policy }]
}

/**
 * The "…" of a folded trail: a menu of the crumbs it stands for, each a real
 * link where the trail had one (a plain line where it had none), so nothing
 * the full trail offered is out of reach.
 */
function FoldedCrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="breadcrumb-folded"
        aria-label="Earlier pages in the trail"
        className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm text-ink-muted focus-halo hover:text-ink focus-visible:outline-none"
      >
        <span aria-hidden>…</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" title="Earlier pages">
        {crumbs.map((crumb) => (
          <DropdownMenuItem
            key={`${crumb.label}-${crumb.href ?? ""}`}
            render={crumb.href ? <ShellLink href={crumb.href} /> : undefined}
            disabled={!crumb.href}
          >
            <span className="min-w-0 truncate">{crumb.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The desk toolbar's trail, from 1180px (`wide`). Narrower screens show the
 * labelled back control instead: at 768 every crumb truncated to a few
 * letters and repeated the eyebrow and the h1 below it.
 *
 * Slash-separated, the ancestors muted links and the current page in
 * semibold ink. A trail of more than three folds its middle into one "…"
 * menu of links (DSK-05): a listing's area reads "Listings / … / Hours",
 * since the page header right below already names the listing and
 * switches it: the view's title, as in the Notion Mail header. When the
 * page registered a count (`<PageChrome count>`), it follows the title in
 * muted figures ("Inbox 12"); visual only, as the page's own h1 or region
 * carries it for assistive technology.
 *
 * No trail at all for a route with one crumb: it would only repeat the
 * page's h1. (The page's count then has no trail to follow; it shows in the
 * page itself.)
 *
 * A `nav > ol > li` with no heading of any kind: the axe suite pins
 * `heading-order` and `page-has-heading-one`, and a heading here would land
 * above the page's own `h1`.
 */
function ShellBreadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname()
  const trail = deskTrail(pathname, useShellTrail())
  const crumbs = foldTrail(trail)
  const { count, countLabel } = usePageChromeOverride()
  const shownCount = count && count > 0 ? count : undefined

  // A lone crumb with no link only repeats the h1 beneath it ("Inbox" over
  // "Inbox"). One that links to a parent (a listing whose name has not
  // loaded yet) is still the way up, so it stays.
  if (trail.length === 0 || (trail.length === 1 && !trail[0].href))
    return <div className={className} />
  // That lone crumb is a link, not the current page.
  const loneLink = trail.length === 1

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
              {crumb.folded ? (
                <FoldedCrumbs crumbs={crumb.folded} />
              ) : (isLast && !loneLink) || !crumb.href ? (
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
                <ShellLink
                  href={crumb.href}
                  title={crumb.label}
                  className="max-w-[16rem] min-w-0 truncate rounded-sm text-ink-muted underline-offset-3 focus-halo hover:text-ink hover:underline focus-visible:outline-none"
                >
                  {crumb.label}
                </ShellLink>
              )}
              {isLast && shownCount !== undefined ? (
                <span
                  aria-hidden
                  data-slot="breadcrumb-count"
                  // What the figure counts, on hover ("12 need a reply").
                  title={countLabel ? `${shownCount} ${countLabel}` : undefined}
                  className="shrink-0 text-ink-muted tabular-nums"
                >
                  {shownCount > 99 ? "99+" : shownCount}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export { ShellBreadcrumbs, useShellBack, useShellTrail }
