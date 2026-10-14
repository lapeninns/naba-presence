"use client"

import Link from "next/link"
import { useState } from "react"
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
import { Input, inputHints } from "@/components/ui/input"
import { SectionHeader } from "@/components/ui/section-header"
import { SettingsRow } from "@/components/ui/settings-row"
import { googleAccountNameSchema } from "@/lib/contracts/google-administration-review"
import { normaliseAccountName } from "@/lib/locations/forms/administration"
import { SectionGateNote, useAdministrationSection } from "./context"
import { LifecycleWorkspace, useLifecycleContext } from "./lifecycle-workspace"

// On a phone the row's control drops under its words instead of squeezing them.
const ROW = "max-sm:flex-wrap max-sm:*:first:basis-full"

export function DangerZone() {
  const section = useAdministrationSection(),
    workflow = useLifecycleContext()
  if (!workflow)
    return (
      <LifecycleWorkspace
        locationId={section.locationId}
        locationName={section.locationName}
      >
        <DangerZoneControls />
      </LifecycleWorkspace>
    )
  return <DangerZoneControls />
}

function DangerZoneControls() {
  const section = useAdministrationSection(),
    workflow = useLifecycleContext()
  const [collecting, setCollecting] = useState(false),
    [deleting, setDeleting] = useState(false)
  const [destination, setDestination] = useState("")
  const parsed = googleAccountNameSchema.safeParse(
    normaliseAccountName(destination)
  )
  const blocked =
    section.writeBlocked ||
    !section.locationName ||
    !workflow ||
    workflow.busy ||
    workflow.unresolved
  function closeTransfer(next: boolean) {
    setCollecting(next)
    if (!next) setDestination("")
  }
  async function previewTransfer() {
    if (!workflow || !parsed.success) return
    try {
      await workflow.preview({
        operation: "transfer_location",
        payload: { destinationAccount: parsed.data },
      })
      closeTransfer(false)
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }
  async function previewDeletion() {
    if (!workflow) return
    try {
      await workflow.preview({ operation: "delete_location", payload: {} })
      setDeleting(false)
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }
  // Settings rows (Notion Mail's settings look): each row a title and its
  // consequence, with its control trailing (under the text on a phone).
  // Last on the page; every destructive step still goes through a saved
  // review and the typed listing name at send. The section keeps its own
  // h2 and the named list, which `SettingsGroup` cannot carry, so the rows
  // sit in that list directly. Each blocked row says why under its words.
  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="flex min-w-0 flex-col gap-3"
    >
      <SectionHeader
        id="danger-zone-heading"
        title="Danger zone"
        description="Review an exact lifecycle request before approval and sending. Google may reject a request, and NabaPresence cannot undo an accepted deletion."
      />
      <ul aria-label="Danger zone actions" className="flex min-w-0 flex-col">
        <SettingsRow
          className={ROW}
          label="Transfer this location"
          description={
            <>
              Move the exact Google location between accounts. Current source
              ownership and destination management access must be established.
              <SectionGateNote />
            </>
          }
          action={
            <Button
              variant="danger-outline"
              size="sm"
              disabled={blocked}
              onClick={() => setCollecting(true)}
            >
              Transfer this location
            </Button>
          }
        />
        <SettingsRow
          className={ROW}
          label="Remove from NabaPresence"
          description={
            <>
              Unlink this app location under{" "}
              <Link
                href="/settings/connections"
                className="rounded-(--np-radius-tag) font-medium text-accent-ink underline-offset-3 focus-halo hover:underline"
              >
                Connections
              </Link>
              . Unlinking does not request a change to the business on Google.
            </>
          }
        />
        <SettingsRow
          className={ROW}
          label={
            <span className="text-danger-ink">Request deletion on Google</span>
          }
          description={
            <>
              Request deletion of the managed Business Profile location.
              Search/Maps removal and customer-review deletion are not
              guaranteed.
              <SectionGateNote />
            </>
          }
          action={
            <Button
              variant="danger-outline"
              size="sm"
              disabled={blocked}
              onClick={() => setDeleting(true)}
            >
              Delete this location
            </Button>
          }
        />
      </ul>
      <Dialog
        open={collecting}
        onOpenChange={closeTransfer}
        dirty={destination.trim().length > 0}
        onDiscard={() => setDestination("")}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer this location</DialogTitle>
            <DialogDescription>
              Choose an exact destination account, then review current access
              and the frozen transfer. This step sends no provider write.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex min-w-0 flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!blocked && parsed.success) void previewTransfer()
            }}
          >
            <Field
              error={
                destination.trim().length > 0 && !parsed.success
                  ? "Select an exact Google account resource, such as accounts/123."
                  : undefined
              }
            >
              <FieldLabel htmlFor="lifecycle-destination">
                Destination Google account
              </FieldLabel>
              <Input
                id="lifecycle-destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="accounts/…"
                disabled={workflow?.busy}
                {...inputHints.identifier}
              />
              <FieldError />
            </Field>
            {workflow?.error ? (
              <p role="alert" className="text-ui text-danger-ink">
                {workflow.error}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose
                render={
                  <Button variant="ghost" disabled={workflow?.busy}>
                    Cancel
                  </Button>
                }
              />
              <Button
                type="submit"
                disabled={blocked || !parsed.success}
                pending={workflow?.busy}
              >
                Continue to transfer review
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review managed-location deletion</DialogTitle>
            <DialogDescription>
              Google&apos;s current deletion eligibility and exact account
              membership will be read before saving a review. No deletion is
              sent at this step. The business and customer reviews may remain on
              Search or Maps.
            </DialogDescription>
          </DialogHeader>
          {workflow?.error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {workflow.error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="ghost" disabled={workflow?.busy}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="danger-outline"
              disabled={blocked}
              pending={workflow?.busy}
              onClick={() => {
                void previewDeletion()
              }}
            >
              Prepare deletion review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
