"use client"

import Link from "next/link"
import { useState } from "react"

import { DangerZoneDialog } from "@/components/locations/danger-zone-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  DANGER_ZONE_OPERATIONS,
  runAdministrationOperation,
  type AdministrationOperation,
} from "@/lib/api/location-administration"
import { transferLocationSchema } from "@/lib/locations/forms/administration"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import { cn } from "@/lib/utils"

import { SectionGateNote, useAdministrationSection } from "./context"

// A defensive wrapper for the three destructive Google operations (remove
// admin / transfer / delete location). Checking membership in the T1 client's
// own DANGER_ZONE_OPERATIONS set - rather than trusting the call site - means
// a future edit that accidentally routes a non-destructive operation through
// the typed-name confirmation path fails loudly instead of silently skipping
// the UI-side gate.
export function runDangerZoneOperation(
  locationId: string,
  operation: AdministrationOperation,
  payload: Record<string, unknown>
) {
  if (!DANGER_ZONE_OPERATIONS.has(operation)) {
    throw new Error(`${operation} is not a danger-zone operation`)
  }
  return runAdministrationOperation(locationId, { operation, payload })
}

// --- Danger zone -----------------------------------------------------------
// The three destructive Google operations (spec §11, D9): remove an
// administrator (row-level, in admins.tsx), transfer this location to another
// Google account, and permanently delete this location from Google. Every
// action here is two-layer gated: the DangerZoneDialog's typed-location-name
// confirmation (UI layer) AND the exact backend confirmation literal sent by
// runDangerZoneOperation (route layer) - see app/api/locations/[id]/administration/route.ts
// CONFIRMATIONS, transcribed into lib/contracts/location-administration.ts.
// Deletion here is Google's PERMANENT delete (deleteGoogleLocation) - it is
// never the app-side soft unlink (DELETE /api/location-links); the note below
// points people who want that at Connections instead.
export function DangerZone() {
  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="flex flex-col overflow-hidden rounded-(--np-radius-card) border border-danger-ink bg-surface"
    >
      <div className="flex flex-col gap-0.5 border-b border-line px-4 py-3">
        <h2
          id="danger-zone-heading"
          className="text-title font-semibold text-ink"
        >
          Danger zone
        </h2>
        <p className="text-ui text-ink-muted">
          These change how this location exists on Google. Each asks you to
          type the listing’s name first, and none can be undone from here.
        </p>
      </div>
      <ul aria-label="Danger zone actions" className="flex list-none flex-col">
        <TransferLocationAction />
        <DangerRow
          title="Remove from NabaPresence"
          description={
            <>
              To stop managing a location without deleting it from Google,
              unlink it under{" "}
              <Link
                href="/settings/connections"
                className="rounded-(--np-radius-tag) font-medium text-accent-ink underline-offset-3 focus-halo hover:underline"
              >
                Connections
              </Link>
              . The listing stays on Google exactly as it is.
            </>
          }
          gate={false}
        />
        <DeleteLocationAction />
      </ul>
    </section>
  )
}

/**
 * One destructive row: title and consequence on the left, the action at the
 * trailing edge, and the per-action gate note beneath.
 */
function DangerRow({
  title,
  description,
  action,
  tone = "default",
  gate = true,
  children,
}: {
  title: string
  description: React.ReactNode
  action?: React.ReactNode
  tone?: "default" | "danger"
  /** Show the per-action publish gate note (Google writes only). */
  gate?: boolean
  children?: React.ReactNode
}) {
  return (
    <li
      data-tone={tone}
      className="flex flex-col justify-center gap-2 border-t border-line px-4 py-4 first:border-t-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-0.5">
          <p
            className={cn(
              "text-body font-semibold",
              tone === "danger" ? "text-danger-ink" : "text-ink"
            )}
          >
            {title}
          </p>
          <p className="text-ui text-ink-muted">{description}</p>
        </div>
        {action}
      </div>
      {gate ? <SectionGateNote /> : null}
      {children}
    </li>
  )
}

function TransferLocationAction() {
  const { locationId, locationName, writeBlocked } = useAdministrationSection()
  // Step 1 (a plain Dialog) collects and validates destinationAccount. Step 2
  // (DangerZoneDialog) then requires the typed location name before sending
  // the request - "collect destinationAccount THEN require the typed name"
  // (spec §11). `destinationAccount` is owned by this component (not the
  // step-1 dialog), so it survives that dialog closing and step 2 opening.
  const [collecting, setCollecting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [destinationAccount, setDestinationAccount] = useState("")

  const parsed = transferLocationSchema.safeParse({ destinationAccount })
  const fieldError =
    destinationAccount.trim().length > 0 && !parsed.success
      ? parsed.error.issues.find(
          (issue) => issue.path[0] === "destinationAccount"
        )?.message
      : undefined

  const transfer = useResourceMutation({
    mutationFn: () => {
      const values = transferLocationSchema.parse({ destinationAccount })
      return runDangerZoneOperation(locationId, "transfer_location", values)
    },
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Location transfer requested",
    onSuccess: () => {
      setConfirming(false)
      setDestinationAccount("")
    },
  })

  return (
    <DangerRow
      title="Transfer this location"
      description="Move this Google location to another Google account. NabaPresence may lose access to it."
      action={
        <Button
          variant="danger-outline"
          size="sm"
          onClick={() => setCollecting(true)}
          disabled={writeBlocked || !locationName}
        >
          Transfer this location
        </Button>
      }
    >
      <Dialog
        open={collecting}
        onOpenChange={(next) => {
          setCollecting(next)
          if (!next) setDestinationAccount("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer this location</DialogTitle>
            <DialogDescription>
              This moves the Google location to another Google account.
              NabaPresence may lose the ability to manage it, and this cannot be
              undone from here.
            </DialogDescription>
          </DialogHeader>
          <Field error={fieldError}>
            <FieldLabel>Destination Google account</FieldLabel>
            <Input
              value={destinationAccount}
              onChange={(event) => setDestinationAccount(event.target.value)}
              placeholder="accounts/1234567890"
              autoComplete="off"
            />
            <FieldError />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              disabled={!parsed.success}
              onClick={() => {
                setCollecting(false)
                setConfirming(true)
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DangerZoneDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Transfer this location?"
        description={`This moves the Google location to another Google account (${destinationAccount}). NabaPresence may lose the ability to manage it, and this cannot be undone from here.`}
        expectedName={locationName}
        confirmLabel="Transfer location"
        pending={transfer.isPending}
        onConfirm={() => transfer.mutate()}
      />
    </DangerRow>
  )
}

function DeleteLocationAction() {
  const { locationId, locationName, writeBlocked } = useAdministrationSection()
  const [open, setOpen] = useState(false)

  const remove = useResourceMutation({
    // Google's PERMANENT delete (deleteGoogleLocation on the server) - not
    // the app-side soft unlink. Empty payload: the route resolves the
    // Google location from the session's own link, so no id needs sending.
    mutationFn: () => runDangerZoneOperation(locationId, "delete_location", {}),
    invalidate: [queryKeys.locationAdministration(locationId)],
    successToast: "Location deleted from Google",
    onSuccess: () => setOpen(false),
  })

  return (
    <DangerRow
      title="Delete on Google"
      description="Permanently delete the listing from Google. Customers can no longer find it on Search or Maps."
      tone="danger"
      action={
        <Button
          variant="danger-outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={writeBlocked || !locationName}
        >
          Delete this location
        </Button>
      }
    >
      <DangerZoneDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this location from Google?"
        description="This permanently deletes the Google listing: customers can no longer find it, and Google deletes its reviews, photos and posts. It cannot be undone."
        expectedName={locationName}
        confirmLabel="Delete location"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </DangerRow>
  )
}
