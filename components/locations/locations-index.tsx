"use client"

import Link from "next/link"

import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLocationDirectory } from "@/lib/queries/use-locations"

function formatAddress(address: unknown): string {
  if (!address || typeof address !== "object") return "—"
  const record = address as Record<string, unknown>
  const lines = Array.isArray(record.addressLines) ? (record.addressLines as unknown[]).filter((x) => typeof x === "string") : []
  const parts = [...lines, record.locality, record.administrativeArea, record.postalCode].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0
  )
  return parts.length ? parts.join(", ") : "—"
}

export function LocationsIndex({ role }: { role: string | null }) {
  const management = role === "owner" || role === "admin"
  const directory = useLocationDirectory(role)

  if (directory.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }
  if (directory.isError) {
    return (
      <Empty
        title="We couldn’t load your locations"
        description="Something went wrong reaching the server."
        action={<Button variant="outline" onClick={() => directory.refetch()}>Try again</Button>}
      />
    )
  }
  const locations = directory.data ?? []
  if (locations.length === 0) {
    return <NoLocationEmpty role={role} />
  }

  if (!management) {
    return (
      <Table className="min-w-[360px]">
        <TableHeader>
          <TableRow>
            <TableHead>Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {locations.map((location) => (
            <TableRow key={location.id}>
              <TableCell className="font-medium">
                <Link href={`/locations/${location.id}`} className="underline-offset-4 hover:underline">
                  {location.name}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <Table className="min-w-[640px]">
      <TableHeader>
        <TableRow>
          <TableHead>Location</TableHead>
          <TableHead>Address</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {locations.map((location) => (
          <TableRow key={location.id}>
            <TableCell className="font-medium">
              <Link href={`/locations/${location.id}`} className="underline-offset-4 hover:underline">
                {location.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatAddress(location.address)}</TableCell>
            <TableCell>
              <span className="flex flex-wrap gap-1.5">
                {location.linked ? <Badge variant="secondary">Linked</Badge> : <Badge variant="outline">Not linked</Badge>}
                {location.verified ? <Badge variant="success">Verified</Badge> : null}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
