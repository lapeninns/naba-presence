"use client"

import Link from "next/link"

import { ClientAvatar } from "@/components/clients/client-avatar"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import {
  useLocationDirectory,
  type DirectoryEntry,
} from "@/lib/queries/use-locations"
import { TONE_CLASSES, type StatusTone } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

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
 * The Google state of one row, as a tone for its dot and the word the dot
 * stands for. Only the management payload carries `verified`, so the default
 * (member) list never calls these.
 */
function googleTone(location: DirectoryEntry): StatusTone {
  if (!location.linked) return "neutral"
  return location.verified ? "healthy" : "pending"
}

function googleWord(location: DirectoryEntry): string {
  if (!location.linked) return "Not linked"
  return location.verified ? "Verified" : "Pending verification"
}

/** The skeleton draws the list's own shape: a group caption, then a white card of rows. */
function LocationsIndexSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <div className="flex items-center gap-2.5 px-(--np-card-pad)">
        <Skeleton className="size-6 rounded-(--np-radius-control)" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex flex-col divide-y divide-line-subtle rounded-(--np-radius-card) bg-surface px-(--np-cell-px)">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex h-(--np-row-h) items-center gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Every location in the agency, grouped by client.
 *
 * Off the primary navigation: an agency navigates by client, and this is the
 * flat view for the times that fails — finding a venue whose client you have
 * forgotten, or filing the locations Google imported before anyone assigned
 * them. That second job is why unassigned locations come FIRST rather than
 * being buried under the clients that are already in order.
 *
 * Each group is a Mac list: a caption naming the client, then a white card of
 * hairline-divided rows with a health dot and the name leading, the address
 * as muted caption metadata, and the Google state in words at the trailing
 * edge. There is no "last synced" column because the directory payload
 * carries no sync timestamp; showing one would be a claim the data cannot
 * back.
 */
export function LocationsIndex({ role }: { role: string | null }) {
  const management = role === "owner" || role === "admin"
  const directory = useLocationDirectory(role)

  if (directory.isPending) return <LocationsIndexSkeleton />
  if (directory.isError) {
    return (
      <Empty
        title="We couldn't load your locations"
        description="Something went wrong reaching the server."
        action={
          <Button variant="secondary" onClick={() => directory.refetch()}>
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

  const nameLink = (location: DirectoryEntry) => (
    <Link
      href={`/locations/${location.id}`}
      className="inline-flex min-h-6 items-center rounded-(--np-radius-tag) font-medium text-ink underline-offset-4 focus-halo hover:underline"
    >
      {location.name}
    </Link>
  )
  // Owners and admins see the health dot in front of the name; the word it
  // stands for is the Google column on the same row. Members get the plain
  // list: their payload withholds `verified`, and a dot that could only ever
  // say "linked" would read as a health it cannot prove.
  const nameColumn = {
    id: "name",
    header: "Location",
    cell: (location: DirectoryEntry) =>
      management ? (
        <span className="flex items-center gap-2.5">
          <StatusPill variant="dot" tone={googleTone(location)} />
          {nameLink(location)}
        </span>
      ) : (
        nameLink(location)
      ),
  }

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {ordered.map(([key, group]) => (
        <section key={key} className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 px-(--np-card-pad)">
            {key === "__unassigned" ? null : (
              <ClientAvatar name={group.name} className="size-6 text-caption" />
            )}
            <h2 className="text-title font-semibold text-ink">
              {key === "__unassigned" ? (
                group.name
              ) : (
                <Link
                  href={`/clients/${key}`}
                  className="rounded-(--np-radius-tag) underline-offset-4 focus-halo hover:underline"
                >
                  {group.name}
                </Link>
              )}
            </h2>
            <span className="text-caption text-ink-muted tabular-nums">
              {group.rows.length === 1
                ? "1 location"
                : `${group.rows.length} locations`}
            </span>
          </div>

          {key === "__unassigned" ? (
            <p className="px-(--np-card-pad) text-ui text-ink-muted">
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
            surface
            columns={
              management
                ? [
                    nameColumn,
                    {
                      id: "address",
                      header: "Address",
                      cell: (location) => (
                        <span className="text-caption text-ink-muted">
                          {formatAddress(location.address)}
                        </span>
                      ),
                    },
                    {
                      id: "status",
                      header: "Google",
                      className: "whitespace-nowrap",
                      cell: (location) => (
                        <span
                          className={cn(
                            "text-caption",
                            TONE_CLASSES[googleTone(location)].text
                          )}
                        >
                          {googleWord(location)}
                        </span>
                      ),
                    },
                  ]
                : [nameColumn]
            }
          />
        </section>
      ))}
    </div>
  )
}
