"use client"

import { ArrowLeft, ChevronRight, FileQuestion, Search } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  BoundaryCode,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"
import {
  openCommandPalette,
  useShortcutHint,
} from "@/components/app-shell/command-palette"
import { useShellNavigation } from "@/components/app-shell/shell-navigation"
import { visibleDestinations } from "@/lib/navigation/destinations"
import { useSessionRole } from "@/lib/queries/use-session"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * The body of the dashboard 404: a calm, centred empty state (an outline
 * icon, the title, why, one primary action) followed by the destinations
 * drawn as drawer rows (icon, label, chevron, 48px tall) under a muted
 * group label. Team is offered only to the roles that can open it.
 *
 * Frameless, so it can sit in a boundary's frame (app/(dashboard)/
 * not-found.tsx) or straight inside a page that already has one (a
 * disabled settings route, settings/billing-disabled.tsx). A page that
 * calls `notFound()` under the dashboard's `loading.tsx` is already
 * streaming, so React drops that subtree and the boundary is drawn only
 * after hydration, on the phone's slow path. A page that renders this
 * itself is part of the streamed HTML.
 *
 * Plain markup and the light helpers in components/app-shell/boundary.tsx
 * only (the palette module is the shell's own, already loaded). The
 * destination links don't prefetch: this page is rarely used, and a
 * background route request for every row on every visit is not worth a
 * faster click.
 */
export function NotFoundContent() {
  const pathname = usePathname()
  const role = useSessionRole()
  const shortcut = useShortcutHint()
  const mode = useWorkspaceMode()
  const business = mode === "business"
  // The shell's own destination list (lib/navigation/destinations.ts), so
  // this page offers exactly what the navigation does for this role and
  // mode, including leaving Calendar out when scheduling is off (the shell
  // holds that flag; outside the shell it is unknown and Calendar shows).
  const hideCalendar = useShellNavigation()?.hideCalendar ?? false
  const destinations = visibleDestinations({ role, mode, hideCalendar }).map(
    (destination) => ({
      ...destination,
      description: destination.description[mode],
    })
  )

  return (
    <>
      <div
        data-slot="page-empty-state"
        className="flex flex-col items-center gap-2 pt-6 text-center sm:pt-12 lg:pt-16"
      >
        <span
          aria-hidden
          className="mb-1 grid size-11 place-items-center rounded-lg bg-fill text-ink-secondary"
        >
          <FileQuestion className="size-5" strokeWidth={1.5} />
        </span>
        <h1
          tabIndex={-1}
          className="text-title font-medium text-balance text-ink outline-none"
        >
          This page doesn’t exist
        </h1>
        <p className="max-w-md text-ui text-pretty text-ink-muted">
          {business
            ? "The listing or page you followed may have been removed, or the link may be wrong. Nothing was changed."
            : "The client, listing or page you followed may have been removed, or the link may be wrong. Nothing was changed."}
        </p>
        {pathname ? (
          <p className="flex max-w-full min-w-0 flex-wrap items-center justify-center gap-2 text-caption text-ink-muted">
            You asked for <BoundaryCode>{pathname}</BoundaryCode>
          </p>
        ) : null}
        <div className="mt-3 flex w-full max-w-sm flex-col items-stretch gap-1 sm:w-auto sm:items-center">
          <Link
            href="/inbox"
            prefetch={false}
            className={boundaryButtonClass(
              "primary",
              "default",
              "pointer-coarse:min-h-11"
            )}
          >
            <ArrowLeft strokeWidth={1.75} aria-hidden />
            Back to Inbox
          </Link>
          <button
            type="button"
            className={boundaryButtonClass(
              "ghost",
              "default",
              "text-ink-secondary pointer-coarse:min-h-11"
            )}
            onClick={openCommandPalette}
          >
            <Search strokeWidth={1.75} aria-hidden />
            {business ? "Search listings" : "Search clients and listings"}
            <kbd
              aria-hidden
              className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-b-2 border-line bg-surface px-1 font-mono text-caption text-ink-muted tabular-nums max-md:hidden"
            >
              {shortcut}
            </kbd>
          </button>
        </div>
      </div>

      <section
        aria-labelledby="where-to-go"
        className="mx-auto flex w-full max-w-md flex-col gap-1"
      >
        <h2
          id="where-to-go"
          className="px-3 text-ui font-medium text-ink-muted"
        >
          Where to go instead
        </h2>
        <ul className="flex flex-col">
          {destinations.map((destination) => (
            <li key={destination.href}>
              <Link
                href={destination.href}
                prefetch={false}
                className="flex min-h-12 items-center gap-3 rounded-(--np-radius-menu) px-3 py-1.5 text-ink focus-halo transition-colors duration-(--np-duration-fast) focus-visible:outline-none hover-fine:bg-fill"
              >
                <destination.icon
                  aria-hidden
                  className="size-5 shrink-0 text-ink-secondary"
                  strokeWidth={1.5}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">
                    {destination.label}
                  </span>
                  <span className="text-caption text-pretty text-ink-muted">
                    {destination.description}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-ink-muted"
                  strokeWidth={1.75}
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="link-help"
        className="mx-auto flex w-full max-w-md flex-col gap-1 px-3 text-center"
      >
        <h2 id="link-help" className="text-ui font-medium text-ink">
          Followed a link from a teammate?
        </h2>
        <p className="text-caption text-pretty text-ink-muted">
          {business
            ? "Ask them to open it again. If it still fails, the listing was probably removed. If you can’t see a location they can, an owner or admin can give you access from the Team page."
            : "Ask them to open it again. If it still fails, the client or listing was probably removed. If you can’t see a client they can, an owner or admin can give you access from the Team page."}
        </p>
      </section>
    </>
  )
}
