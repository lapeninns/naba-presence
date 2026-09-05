"use client"

import { useState } from "react"

import { EditorFrame } from "@/components/editors/editor-frame"
import { LocationTab } from "@/components/locations/location-tab"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  createPlaceAction,
  deletePlaceAction,
  type PlaceActionLink,
  type PlaceActionType,
  type PlaceActionsState,
} from "@/lib/api/location-booking"
import { queryKeys } from "@/lib/queries/keys"
import { usePlaceActions } from "@/lib/queries/use-location-booking"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

export function humaniseActionType(type: string): string {
  const lower = type.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function BookingTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      loadingLabel="booking links"
      useResource={usePlaceActions}
      resource="booking"
    >
      {({ data: state, publishReason }) => (
        <EditorFrame
          title="Booking links"
          description="The buttons customers see on the listing: reserve a table, book a room, order online. Changes reach Google straight away."
          gateReason={publishReason}
          gateTitle="You can look, but not change these links"
        >
          <BookingLinks
            locationId={locationId}
            state={state}
            writeReason={publishReason}
          />
        </EditorFrame>
      )}
    </LocationTab>
  )
}

function BookingLinks({
  locationId,
  state,
  writeReason,
}: {
  locationId: string
  state: PlaceActionsState
  /** Why Google writes are blocked for this resource, or null. Booking links are Google-direct, so this is the only gate. */
  writeReason: string | null
}) {
  const [type, setType] = useState<PlaceActionType>(
    (state.supportedTypes[0] as PlaceActionType) ?? "DINING_RESERVATION"
  )
  const [uri, setUri] = useState("")
  const [preferred, setPreferred] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PlaceActionLink | null>(null)

  const disabled = writeReason !== null

  const add = useResourceMutation({
    mutationFn: () =>
      createPlaceAction(locationId, {
        uri,
        placeActionType: type,
        isPreferred: preferred,
      }),
    invalidate: [queryKeys.locationBooking(locationId)],
    successToast: "Booking link added",
    onSuccess: () => {
      setUri("")
      setPreferred(false)
    },
  })

  const remove = useResourceMutation({
    mutationFn: (link: PlaceActionLink) =>
      deletePlaceAction(locationId, link.id, {
        expectedGoogleHash: link.googleHash,
      }),
    invalidate: [queryKeys.locationBooking(locationId)],
    successToast: "Booking link removed",
    onSuccess: () => setDeleteTarget(null),
  })

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <section className="flex flex-col gap-2">
        {state.links.length === 0 ? (
          <p className="text-ui text-ink-muted">
            No booking links yet. Add one below and it appears on the listing.
          </p>
        ) : (
          <div className="overflow-hidden rounded-(--np-radius-card) bg-surface">
            <Table className="min-w-140">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead>Preferred</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.links.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell className="font-medium text-ink">
                      {humaniseActionType(link.placeActionType)}
                    </TableCell>
                    <TableCell className="max-w-60 truncate text-ink-muted">
                      {link.uri}
                    </TableCell>
                    <TableCell>
                      {link.isPreferred ? (
                        <Badge variant="tinted">Preferred</Badge>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {link.isEditable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(link)}
                          disabled={disabled}
                          aria-label={`Remove the ${humaniseActionType(link.placeActionType)} link`}
                        >
                          Remove
                        </Button>
                      ) : (
                        <Badge variant="secondary">Managed by Google</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
        <h3 className="text-title font-semibold text-ink">
          Add a booking link
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field>
            <FieldLabel>Type</FieldLabel>
            <Select
              value={type}
              onValueChange={(next) => setType(next as PlaceActionType)}
            >
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
          </Field>
          <Field>
            <FieldLabel>Link</FieldLabel>
            <Input
              value={uri}
              onChange={(event) => setUri(event.target.value)}
              placeholder="https://…"
              inputMode="url"
              className="w-72"
              disabled={disabled}
            />
          </Field>
          <div className="flex h-(--np-field-h) items-center gap-2 text-ui text-ink">
            <Switch
              checked={preferred}
              onCheckedChange={(value) => setPreferred(value === true)}
              disabled={disabled}
              aria-label="Preferred link"
            />
            <span aria-hidden>Preferred</span>
          </div>
          <Button
            variant="secondary"
            onClick={() => add.mutate()}
            disabled={disabled || uri.trim().length === 0 || add.isPending}
          >
            Add booking link
          </Button>
        </div>
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
