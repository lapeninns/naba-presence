"use client"

import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { describeActionError } from "@/lib/settings/action-errors"
import type { ConnectionSummary } from "@/lib/api/connections"

const STATUS: Record<string, { label: string; variant: "success" | "secondary" | "warning" | "outline" }> = {
  active: { label: "Connected", variant: "success" },
  disconnected: { label: "Disconnected", variant: "outline" },
  revoked: { label: "Access revoked", variant: "warning" },
  expired: { label: "Access expired", variant: "warning" },
}

function statusBadge(status: string) {
  const entry = STATUS[status] ?? { label: status, variant: "secondary" as const }
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}

export function ConnectionCard() {
  const { query, connect, disconnect } = useConnectionWorkspace()
  const [pendingDisconnect, setPendingDisconnect] = useState<ConnectionSummary | null>(null)

  if (query.isPending) {
    return <Skeleton className="h-40 w-full" />
  }
  if (query.isError) {
    return (
      <Empty
        title="We couldn’t load your connections"
        description={describeActionError(query.error)}
        action={<Button variant="outline" onClick={() => query.refetch()}>Try again</Button>}
      />
    )
  }

  const connections = query.data.connections

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Google account</h2>
      {connections.length === 0 ? (
        <Empty
          title="No Google account connected"
          description="Connect a Google Business Profile to import locations and manage reviews."
          action={
            <Button disabled={connect.isPending} onClick={() => connect.mutate()}>
              Connect Google Business Profile
            </Button>
          }
        />
      ) : (
        <>
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell className="font-medium">{connection.googleEmail ?? "Google account"}</TableCell>
                  <TableCell>{statusBadge(connection.status)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disconnect.isPending || connection.status === "disconnected"}
                      aria-label={`Disconnect ${connection.googleEmail ?? "Google account"}`}
                      onClick={() => setPendingDisconnect(connection)}
                    >
                      Disconnect
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <Button variant="outline" disabled={connect.isPending} onClick={() => connect.mutate()}>
              Connect another account
            </Button>
          </div>
        </>
      )}

      <OverwriteConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null)
        }}
        title="Disconnect this Google account?"
        description="Reviews and publishing stop immediately. Linked locations and notifications are deactivated, and the account’s data is permanently removed after 7 days."
        confirmLabel="Disconnect"
        requireAcknowledgement
        acknowledgementLabel="I understand this deactivates linked locations and purges the data after 7 days."
        pending={disconnect.isPending}
        onConfirm={() => {
          if (pendingDisconnect) {
            disconnect.mutate(pendingDisconnect.id, { onSuccess: () => setPendingDisconnect(null) })
          }
        }}
      />
    </section>
  )
}
