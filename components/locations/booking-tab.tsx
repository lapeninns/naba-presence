"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToastManager } from "@/components/ui/toast"
import {
  createPlaceAction,
  deletePlaceAction,
  type PlaceActionLink,
  type PlaceActionType,
  type PlaceActionsState,
} from "@/lib/api/location-booking"
import { describeActionError } from "@/lib/locations/action-errors"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { usePlaceActions } from "@/lib/queries/use-location-booking"

export function humaniseActionType(type: string): string {
  const lower = type.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function BookingTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const bookingQuery = usePlaceActions(locationId)
  const caps = useLocationCapabilities(locationId).data

  if (bookingQuery.isPending) return <TabLoading />
  if (bookingQuery.isError) return <TabError error={bookingQuery.error} onRetry={() => bookingQuery.refetch()} />

  return (
    <BookingTabLoaded
      locationId={locationId}
      state={bookingQuery.data}
      caps={caps}
      invalidate={() => void queryClient.invalidateQueries({ queryKey: queryKeys.locationBooking(locationId) })}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function BookingTabLoaded({
  locationId,
  state,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  state: PlaceActionsState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [type, setType] = useState<PlaceActionType>((state.supportedTypes[0] as PlaceActionType) ?? "DINING_RESERVATION")
  const [uri, setUri] = useState("")
  const [preferred, setPreferred] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PlaceActionLink | null>(null)

  const writeReason = resourceDisabledReason(caps, "booking", state.writesEnabled)
  const disabled = Boolean(writeReason)

  const add = useMutation({
    mutationFn: () => createPlaceAction(locationId, { uri, placeActionType: type, isPreferred: preferred }),
    onSuccess: () => {
      setUri("")
      setPreferred(false)
      invalidate()
      toast("Booking link added", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const remove = useMutation({
    mutationFn: (link: PlaceActionLink) => deletePlaceAction(locationId, link.id, { expectedGoogleHash: link.googleHash }),
    onSuccess: () => {
      setDeleteTarget(null)
      invalidate()
      toast("Booking link removed", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Booking and action links</h2>
        {state.links.length === 0 ? (
          <p className="text-ui text-muted-foreground">No booking links yet.</p>
        ) : (
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Preferred</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="font-medium">{humaniseActionType(link.placeActionType)}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">{link.uri}</TableCell>
                  <TableCell>{link.isPreferred ? <Badge variant="secondary">Preferred</Badge> : "—"}</TableCell>
                  <TableCell>
                    {link.isEditable ? (
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(link)} disabled={disabled} aria-label={`Remove the ${humaniseActionType(link.placeActionType)} link`}>
                        Remove
                      </Button>
                    ) : (
                      <Badge variant="outline">Managed by Google</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Add a booking link</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Type</span>
            <Select value={type} onValueChange={(next) => setType(next as PlaceActionType)}>
              <SelectTrigger className="w-56" aria-label="Booking link type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.supportedTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humaniseActionType(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-ui">
            <span className="text-caption text-muted-foreground">Link</span>
            <Input value={uri} onChange={(event) => setUri(event.target.value)} placeholder="https://…" inputMode="url" className="w-72" disabled={disabled} />
          </label>
          <label className="flex items-center gap-2 text-ui">
            <Checkbox checked={preferred} onCheckedChange={(value) => setPreferred(value === true)} disabled={disabled} aria-label="Preferred link" />
            Preferred
          </label>
          <Button variant="outline" onClick={() => add.mutate()} disabled={disabled || uri.trim().length === 0 || add.isPending}>
            Add booking link
          </Button>
        </div>
        <GateNote reason={writeReason} />
      </section>

      <OverwriteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this booking link from Google?"
        description="This removes the link from your Google Business Profile."
        confirmLabel="Remove"
        requireAcknowledgement={false}
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </div>
  )
}
