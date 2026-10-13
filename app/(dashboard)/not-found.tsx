"use client"

import { ArrowLeft, ChevronRight, Search } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  BOUNDARY_EYEBROW_CLASS,
  BOUNDARY_TITLE_CLASS,
  BoundaryCode,
  BoundaryFrame,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"
import {
  openCommandPalette,
  useShortcutHint,
} from "@/components/app-shell/command-palette"
import { visibleDestinations } from "@/lib/navigation/destinations"
import { useSessionRole } from "@/lib/queries/use-session"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * Inside the shell, not the bare root 404: someone who follows a stale link to
 * a deleted client should still have their navigation, and a list of where
 * they can go instead. Team is offered only to the roles that can open it.
 *
 * Plain markup and the light helpers in components/app-shell/boundary.tsx
 * only (the palette module is the shell's own, already loaded): this file is
 * bundled into every dashboard segment's not-found chunk.
 */
export default function DashboardNotFound() {
  const pathname = usePathname()
  const role = useSessionRole()
  const shortcut = useShortcutHint()
  const mode = useWorkspaceMode()
  const business = mode === "business"
  // The shell's own destination list (lib/navigation/destinations.ts), so
  // this page offers exactly what the navigation does for this role and
  // mode. Calendar is offered whenever the role may see it: the 404 cannot
  // read the scheduling flag, and the Calendar page explains itself when
  // scheduling is off.
  const destinations = visibleDestinations({ role, mode }).map(
    (destination) => ({
      ...destination,
      description: destination.description[mode],
    })
  )

  return (
    <BoundaryFrame>
      <div
        data-slot="page-empty-state"
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
          <span
            aria-hidden
            className="mb-1.5 flex size-11 items-center justify-center rounded-lg bg-fill text-ink-secondary"
          >
            <Search className="size-5" strokeWidth={1.75} />
          </span>
          <p className={BOUNDARY_EYEBROW_CLASS}>Page not found · 404</p>
          <h1 tabIndex={-1} className={BOUNDARY_TITLE_CLASS}>
            This page doesn’t exist
          </h1>
          <p className="max-w-prose text-body text-pretty text-ink-muted">
            {business
              ? "The listing or page you followed may have been removed, or the link may be wrong. Nothing was changed."
              : "The client, listing or page you followed may have been removed, or the link may be wrong. Nothing was changed."}
          </p>
          {pathname ? (
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-ui text-ink-muted">
              You asked for <BoundaryCode>{pathname}</BoundaryCode>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 @max-md:w-full @max-md:*:flex-1">
          <Link
            href="/inbox"
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
              "outline",
              "default",
              "pointer-coarse:min-h-11"
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

      <section aria-labelledby="where-to-go" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="where-to-go" className="text-section font-semibold text-ink">
            Where to go instead
          </h2>
          <p className="text-ui text-ink-muted">
            The parts of NabaPresence you can reach from here.
          </p>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-3">
          {destinations.map((destination) => (
            <li key={destination.href} className="flex">
              <Link
                href={destination.href}
                className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-line bg-surface p-4 focus-halo transition-[border-color,box-shadow] duration-(--np-duration-fast) hover:border-line-strong hover:shadow-np-raised focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  className="grid size-9 place-items-center rounded-lg bg-surface-alt text-ink-secondary"
                >
                  <destination.icon className="size-4" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold text-ink">
                    {destination.label}
                  </span>
                  <span className="text-ui text-ink-muted">
                    {destination.description}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-4 text-ink-muted"
                  strokeWidth={1.75}
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="link-help"
        className="flex flex-col gap-1.5 rounded-lg bg-surface-alt p-4"
      >
        <h2 id="link-help" className="text-body font-semibold text-ink">
          Followed a link from a teammate?
        </h2>
        <p className="text-ui text-ink-muted">
          {business
            ? "Ask them to open it again. If it still fails, the listing was probably removed. If you can’t see a location they can, an owner or admin can give you access from the Team page."
            : "Ask them to open it again. If it still fails, the client or listing was probably removed. If you can’t see a client they can, an owner or admin can give you access from the Team page."}
        </p>
      </section>
    </BoundaryFrame>
  )
}
