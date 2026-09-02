"use client"

import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiClientError } from "@/lib/api/client"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { useGoogleLocations } from "@/lib/queries/use-google-locations"
import { useLocationImport } from "@/lib/queries/use-location-import"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { describeActionError } from "@/lib/errors/action-errors"
import type { DiscoveredLocation } from "@/lib/api/google-locations"

type RowState = "idle" | "pending" | "imported" | { error: string }

export function ImportCard() {
  const workspace = useConnectionWorkspace()
  const connections = workspace.query.data?.connections ?? []
  const connectionId = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: [],
    selectedConnectionId: null,
    selectedAccountName: null,
  }).connectionId
  const accounts = useGoogleAccounts(connectionId)
  const accountName = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: (accounts.query.data?.accounts ?? []).map((a) => ({ googleAccountName: a.googleAccountName, isActive: a.isActive })),
    selectedConnectionId: connectionId,
    selectedAccountName: null,
  }).accountName

  const discovery = useGoogleLocations(accountName)
  // Read the directory through the shared hook rather than writing a second,
  // differently-shaped value into the same query key: this card and
  // LocationsIndex live in one QueryClient, and whichever wrote last used to
  // win.
  const managed = useLocationDirectory(useSessionRole())
  const { link } = useLocationImport()

  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [relinkTarget, setRelinkTarget] = useState<DiscoveredLocation | null>(null)

  const linkedExternalIds = new Set(
    (managed.data ?? [])
      .map((location) => location.externalLocationId)
      .filter((id): id is string => Boolean(id))
  )

  const importOne = async (location: DiscoveredLocation, confirmRelink: boolean) => {
    setRowState((prev) => ({ ...prev, [location.id]: "pending" }))
    try {
      await link.mutateAsync({ externalLocationId: location.id, confirmRelink })
      setRowState((prev) => ({ ...prev, [location.id]: "imported" }))
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "relink_confirmation_required") {
        setRowState((prev) => ({ ...prev, [location.id]: "idle" }))
        setRelinkTarget(location)
        return
      }
      setRowState((prev) => ({ ...prev, [location.id]: { error: describeActionError(error) } }))
    }
  }

  if (!accountName) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Import locations</h2>
        <Empty title="Choose a Google account" description="Activate a Google account above to discover its locations." />
      </section>
    )
  }
  if (discovery.isPending) {
    return <Skeleton className="h-32 w-full" />
  }
  if (discovery.isError) {
    return (
      <Empty
        title="We couldn’t discover locations"
        description={describeActionError(discovery.error)}
        action={<Button variant="outline" onClick={() => discovery.refetch()}>Try again</Button>}
      />
    )
  }
  if (discovery.data.locations.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Import locations</h2>
        <Empty title="No locations to import" description="This account has no Business Profile locations." />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Import locations</h2>
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>Location</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Import</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {discovery.data.locations.map((location) => {
            const alreadyLinked = linkedExternalIds.has(location.id)
            const state = rowState[location.id] ?? "idle"
            return (
              <TableRow key={location.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {location.title}
                    {location.verified ? <Badge variant="success">Verified</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{location.address || "—"}</TableCell>
                <TableCell>
                  {alreadyLinked || state === "imported" ? (
                    <Badge variant="secondary">Linked</Badge>
                  ) : typeof state === "object" ? (
                    <span className="text-caption text-destructive">{state.error}</span>
                  ) : (
                    <Badge variant="outline">Not linked</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {alreadyLinked || state === "imported" ? (
                    <span className="text-caption text-muted-foreground">Done</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={state === "pending"}
                      aria-label={`Import ${location.title}`}
                      onClick={() => importOne(location, false)}
                    >
                      {state === "pending" ? "Importing…" : "Import"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <OverwriteConfirmDialog
        open={relinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRelinkTarget(null)
        }}
        title="Move this location’s history?"
        description="This Google location was linked before. Confirming re-links it here and moves its historical reviews to this location."
        confirmLabel="Confirm and import"
        requireAcknowledgement
        acknowledgementLabel="I understand historical reviews will move to this location."
        pending={link.isPending}
        onConfirm={() => {
          if (relinkTarget) {
            const target = relinkTarget
            setRelinkTarget(null)
            void importOne(target, true)
          }
        }}
      />
    </section>
  )
}
