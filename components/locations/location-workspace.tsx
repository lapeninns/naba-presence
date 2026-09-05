"use client"

import { notFound, usePathname } from "next/navigation"

import { ClientScopeProvider } from "@/components/app-shell/client-context"
import { LocationTabNav } from "@/components/locations/location-tab-nav"
import { ActivityDrawer } from "@/components/editors/activity-drawer"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useLocationDirectory,
  type DirectoryEntry,
} from "@/lib/queries/use-locations"

function formatAddress(address: unknown): string | null {
  if (!address || typeof address !== "object") return null
  const record = address as Record<string, unknown>
  const lines = Array.isArray(record.addressLines)
    ? (record.addressLines as unknown[]).filter((x) => typeof x === "string")
    : []
  const parts = [
    ...lines,
    record.locality,
    record.administrativeArea,
    record.postalCode,
  ].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0
  )
  return parts.length ? parts.join(", ") : null
}

/**
 * The gutters and bottom padding of PageFrame, negated and then restored as
 * padding on the scrolling pane. Two reasons: a sticky editor footer inside
 * the pane can bleed to the pane's edges (its own negative margins mirror
 * these), and `overflow-y-auto` would otherwise clip that bleed.
 */
const PANE_BLEED =
  "-mx-5 -mb-6 px-5 pb-6 md:-mx-(--np-page-pad-x) md:-mb-(--np-page-pad-y) md:px-(--np-page-pad-x) md:pb-(--np-page-pad-y)"

export function LocationWorkspace({
  locationId,
  role,
  children,
}: {
  locationId: string
  role: string | null
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const directory = useLocationDirectory(role)

  // The directory list is the source of truth for "does this location
  // exist" — hold the whole workspace (header, switcher, tab nav, and the
  // tab content itself) behind its first resolution rather than rendering
  // tab content before we know whether the id is valid. This also keeps
  // notFound() (D2/D3, called once the list has resolved and the id isn't
  // in it) and the workspace chrome landing in the same commit.
  if (directory.isPending) {
    return (
      <PageFrame width="workspace">
        {/* The shape of the context bar below: eyebrow, title with its pill,
            address, and the segmented nav. */}
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-7 w-64 max-w-full" />
              <Skeleton className="h-(--np-pill-h) w-28 rounded-(--np-radius-pill)" />
            </div>
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-(--np-control-h) w-full max-w-xl rounded-(--np-radius-control)" />
        </div>
      </PageFrame>
    )
  }

  const current = directory.data?.find((entry) => entry.id === locationId)
  if (directory.data && !current) {
    notFound()
  }

  const base = `/locations/${locationId}`
  const activeSuffix = pathname.startsWith(base)
    ? pathname.slice(base.length)
    : ""
  const address = current ? formatAddress(current.address) : null
  // Siblings only. Switching between two clients' venues from one dropdown
  // invites publishing to the wrong business; to change client you go through
  // the client, which is also where the breadcrumb points.
  const siblings = (directory.data ?? []).filter(
    (entry) => entry.clientId === current?.clientId
  )
  // Mirrors the server's canEditCanonical gate (role in {owner, admin}) so
  // the Industry/Administration tabs never link to a route that 403s.
  const canManageConsoles = role === "owner" || role === "admin"

  return (
    <ClientScopeProvider clientId={current?.clientId ?? null}>
      <PageFrame width="workspace">
        {/* The context bar: client as the eyebrow, the location name as the
            page's one h1, its Google state beside it, then the section
            switcher. It never scrolls; the pane below does. */}
        <PageHeader
          title={current?.name ?? "Location"}
          eyebrow={current?.clientName ?? undefined}
          meta={
            <span className="flex flex-wrap items-center gap-2">
              {current?.linked ? (
                <StatusPill tone={current.verified ? "healthy" : "pending"}>
                  {current.verified
                    ? "Linked · Verified"
                    : "Linked · Pending verification"}
                </StatusPill>
              ) : (
                <StatusPill tone="neutral">Not linked</StatusPill>
              )}
              {siblings.length > 1 ? (
                <Combobox
                  items={siblings}
                  itemToStringLabel={(entry: DirectoryEntry) => entry.name}
                  value={current ?? null}
                  onValueChange={(next: DirectoryEntry | null) => {
                    if (next)
                      window.location.assign(
                        `/locations/${next.id}${activeSuffix}`
                      )
                  }}
                >
                  <ComboboxInput
                    placeholder="Switch location"
                    aria-label="Switch to another location in this client"
                    wrapperClassName="w-56"
                    className="h-(--np-control-h)"
                  />
                  <ComboboxContent>
                    {siblings.map((entry) => (
                      <ComboboxItem key={entry.id} value={entry}>
                        {entry.name}
                      </ComboboxItem>
                    ))}
                  </ComboboxContent>
                </Combobox>
              ) : null}
            </span>
          }
          description={address ?? undefined}
          actions={<ActivityDrawer locationId={locationId} />}
          tabs={
            <LocationTabNav
              locationId={locationId}
              canManageConsoles={canManageConsoles}
            />
          }
        />

        {/* The scrolling pane: PageFrame width="workspace" hides overflow on
            <main>, so tab content must scroll here rather than squash the
            header and section nav above it. */}
        <div
          className={`flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto ${PANE_BLEED}`}
        >
          {children}
        </div>
      </PageFrame>
    </ClientScopeProvider>
  )
}
