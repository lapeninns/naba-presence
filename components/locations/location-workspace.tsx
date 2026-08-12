"use client"

import { notFound, usePathname } from "next/navigation"

import { LocationTabNav } from "@/components/locations/location-tab-nav"
import { LocationActivityPanel } from "@/components/locations/activity-panel"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Badge } from "@/components/ui/badge"
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem } from "@/components/ui/combobox"
import { Skeleton } from "@/components/ui/skeleton"
import { useLocationDirectory, type DirectoryEntry } from "@/lib/queries/use-locations"

function formatAddress(address: unknown): string | null {
  if (!address || typeof address !== "object") return null
  const record = address as Record<string, unknown>
  const lines = Array.isArray(record.addressLines) ? (record.addressLines as unknown[]).filter((x) => typeof x === "string") : []
  const parts = [...lines, record.locality, record.administrativeArea, record.postalCode].filter(
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
  const activeSuffix = pathname.startsWith(base) ? pathname.slice(base.length) : ""
  const address = current ? formatAddress(current.address) : null
  // Mirrors the server's canEditCanonical gate (role in {owner, admin}) so
  // the Industry/Administration tabs never link to a route that 403s.
  const canManageConsoles = role === "owner" || role === "admin"

  return (
    <PageFrame width="workspace">
      <PageHeader
        title={current?.name ?? "Location"}
        description={
          <span className="flex flex-col gap-1.5">
            {address ? <span className="text-ui text-muted-foreground">{address}</span> : null}
            <span className="flex flex-wrap gap-1.5">
              {current?.linked === false ? <Badge variant="outline">Not linked</Badge> : null}
              {current?.linked ? <Badge variant="secondary">Linked</Badge> : null}
              {current?.verified ? <Badge variant="success">Verified</Badge> : null}
            </span>
          </span>
        }
      />

      {directory.data && directory.data.length > 1 ? (
        <Combobox
          items={directory.data}
          itemToStringLabel={(entry: DirectoryEntry) => entry.name}
          value={current ?? null}
          onValueChange={(next: DirectoryEntry | null) => {
            if (next) window.location.assign(`/locations/${next.id}${activeSuffix}`)
          }}
        >
          <ComboboxInput placeholder="Switch location" aria-label="Switch location" className="max-w-sm" />
          <ComboboxContent>
            {directory.data.map((entry) => (
              <ComboboxItem key={entry.id} value={entry}>
                {entry.name}
              </ComboboxItem>
            ))}
          </ComboboxContent>
        </Combobox>
      ) : null}

      <LocationTabNav locationId={locationId} canManageConsoles={canManageConsoles} />
      <div className="flex flex-col gap-8">
        {children}
        <LocationActivityPanel locationId={locationId} />
      </div>
    </PageFrame>
  )
}
