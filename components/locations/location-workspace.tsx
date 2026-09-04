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
        <Skeleton className="h-16 w-full" />
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
      <PageHeader
        title={current?.name ?? "Location"}
        eyebrow={current?.clientName ?? undefined}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            {current?.linked ? (
              <StatusPill tone={current.verified ? "healthy" : "pending"}>
                {current.verified ? "Linked · Verified" : "Linked · Pending verification"}
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
                    window.location.assign(`/locations/${next.id}${activeSuffix}`)
                }}
              >
                <ComboboxInput
                  placeholder="Switch location"
                  aria-label="Switch to another location in this client"
                  className="h-8 max-w-56"
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
      />

      <LocationTabNav
        locationId={locationId}
        canManageConsoles={canManageConsoles}
      />
      {/* The scrolling pane: PageFrame width="workspace" hides overflow on
          <main>, so tab content must scroll here rather than squash the
          header and section nav above it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto">
        {children}
      </div>
      </PageFrame>
    </ClientScopeProvider>
  )
}

