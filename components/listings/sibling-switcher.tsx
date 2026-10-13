"use client"

import { CheckIcon, ChevronDownIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type * as React from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useLocationDirectory,
  type DirectoryEntry,
} from "@/lib/queries/use-locations"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * Jump to another listing of the same client, keeping the area open.
 *
 * Siblings only. Switching between two clients' listings from one control
 * invites publishing to the wrong business; to change client you go through
 * the client, which is also where the breadcrumb points.
 *
 * The trigger is the line it replaces (the listing's name on an area, the
 * client on the overview), so it costs no row of its own. The list is a
 * menu of real links: an action sheet on a phone with no keyboard raised,
 * client-side navigation, and the editor's leave guard catches the click
 * like any other in-app link. The current listing's row opens its overview.
 *
 * With fewer than two listings under the client there is nothing to switch
 * to: `fallback` (the plain line) renders instead.
 */
function SiblingSwitcher({
  current,
  role,
  children,
  fallback = null,
  className,
}: {
  current: DirectoryEntry
  role: string | null
  /** The trigger's visible words; defaults to the listing's name. */
  children?: React.ReactNode
  /** What to render when there is no sibling to switch to. */
  fallback?: React.ReactNode
  className?: string
}) {
  const pathname = usePathname()
  const business = useWorkspaceMode() === "business"
  const directory = useLocationDirectory(role)
  const siblings = (directory.data ?? []).filter(
    (entry) => entry.clientId === current.clientId
  )
  if (siblings.length < 2) return <>{fallback}</>
  const base = `/listings/${current.id}`
  const suffix = pathname.startsWith(base) ? pathname.slice(base.length) : ""
  const purpose = business
    ? "switch to another listing"
    : "switch to another listing of this client"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="sibling-switcher"
        className={cn(
          "inline-flex min-h-(--np-control-h) max-w-full min-w-0 items-center gap-1 rounded-(--np-radius-tag) text-left text-ink focus-halo hover-fine:underline hover-fine:underline-offset-3",
          className
        )}
      >
        <span className="min-w-0 truncate">{children ?? current.name}</span>
        <span className="sr-only">, {purpose}</span>
        <ChevronDownIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-ink-muted"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        title={business ? "Your listings" : (current.clientName ?? "Listings")}
      >
        {siblings.map((entry) => {
          const isCurrent = entry.id === current.id
          return (
            <DropdownMenuItem
              key={entry.id}
              render={
                <Link
                  href={isCurrent ? base : `/listings/${entry.id}${suffix}`}
                  aria-current={isCurrent ? "true" : undefined}
                />
              }
            >
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {isCurrent ? <CheckIcon aria-hidden /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { SiblingSwitcher }
