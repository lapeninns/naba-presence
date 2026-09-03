"use client"

import Link from "next/link"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { useLocationDirectory, type DirectoryEntry } from "@/lib/queries/use-locations"

function formatAddress(address: unknown): string {
  if (!address || typeof address !== "object") return "—"
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
  return parts.length ? parts.join(", ") : "—"
}

/**
 * Every location in the agency, grouped by client.
 *
 * Off the primary navigation: an agency navigates by client, and this is the
 * flat view for the times that fails — finding a venue whose client you have
 * forgotten, or filing the locations Google imported before anyone assigned
 * them. That second job is why unassigned locations come FIRST rather than
 * being buried under the clients that are already in order.
 */
export function LocationsIndex({ role }: { role: string | null }) {
  const management = role === "owner" || role === "admin"
  const directory = useLocationDirectory(role)

  if (directory.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }
  if (directory.isError) {
    return (
      <Empty
        title="We couldn't load your locations"
        description="Something went wrong reaching the server."
        action={
          <Button variant="outline" onClick={() => directory.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const locations = directory.data ?? []
  if (locations.length === 0) return <NoLocationEmpty role={role} />

  const groups = new Map<string, { name: string; rows: DirectoryEntry[] }>()
  for (const location of locations) {
    const key = location.clientId ?? "__unassigned"
    const name = location.clientName ?? "Unassigned locations"
    const group = groups.get(key) ?? { name, rows: [] }
    group.rows.push(location)
    groups.set(key, group)
  }
  const ordered = [...groups.entries()].sort(([keyA, a], [keyB, b]) => {
    if (keyA === "__unassigned") return -1
    if (keyB === "__unassigned") return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="flex flex-col gap-6">
      {ordered.map(([key, group]) => (
        <section key={key} className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            {key === "__unassigned" ? null : (
              <ClientAvatar name={group.name} className="size-6 text-caption" />
            )}
            <h2 className="text-title">
              {key === "__unassigned" ? (
                group.name
              ) : (
                <Link
                  href={`/clients/${key}`}
                  className="underline-offset-4 hover:underline"
                >
                  {group.name}
                </Link>
              )}
            </h2>
            <span className="text-caption text-ink-muted">
              {group.rows.length === 1 ? "1 location" : `${group.rows.length} locations`}
            </span>
          </div>

          {key === "__unassigned" ? (
            <p className="text-ui text-ink-muted">
              Imported from Google but not filed under a client. They stay out
              of client filters and reports until you assign them, which you do
              from a client&rsquo;s settings.
            </p>
          ) : null}

          <DataTable
            caption={`Locations in ${group.name}`}
            rows={group.rows}
            rowId={(location) => location.id}
            density="compact"
            columns={
              management
                ? [
                    {
                      id: "name",
                      header: "Location",
                      cell: (location) => (
                        <Link
                          href={`/locations/${location.id}`}
                          className="font-medium text-ink underline-offset-4 hover:underline"
                        >
                          {location.name}
                        </Link>
                      ),
                    },
                    {
                      id: "address",
                      header: "Address",
                      cell: (location) => (
                        <span className="text-ink-muted">
                          {formatAddress(location.address)}
                        </span>
                      ),
                    },
                    {
                      id: "status",
                      header: "Google",
                      cell: (location) =>
                        location.linked ? (
                          <StatusPill tone={location.verified ? "healthy" : "pending"}>
                            {location.verified ? "Verified" : "Pending verification"}
                          </StatusPill>
                        ) : (
                          <StatusPill tone="neutral">Not linked</StatusPill>
                        ),
                    },
                  ]
                : [
                    {
                      id: "name",
                      header: "Location",
                      cell: (location) => (
                        <Link
                          href={`/locations/${location.id}`}
                          className="font-medium text-ink underline-offset-4 hover:underline"
                        >
                          {location.name}
                        </Link>
                      ),
                    },
                  ]
            }
          />
        </section>
      ))}
    </div>
  )
}
