"use client"

import Link from "next/link"
import { useState } from "react"
import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FormError,
} from "@/components/ui/field"
import { Input, inputHints } from "@/components/ui/input"
import { SectionHeader } from "@/components/ui/section-header"
import { SettingsRow } from "@/components/ui/settings-row"
import { ApiClientError } from "@/lib/api/client"
import { googleAccountNameSchema } from "@/lib/contracts/google-administration-review"
import { normaliseAccountName } from "@/lib/locations/forms/administration"
import { SectionGateNote, useAdministrationSection } from "./context"
import { LifecycleWorkspace, useLifecycleContext } from "./lifecycle-workspace"

// On a phone the row's control drops under its words instead of squeezing them.
const ROW = "max-sm:flex-wrap max-sm:*:first:basis-full"

const DESTINATION_FORMAT_ERROR =
  "Enter an account ID such as accounts/123456789 or 123456789."

/**
 * The destination as the contract expects it. A bare account ID (what people
 * copy from Google) gains the `accounts/` prefix; everything else is only
 * normalised as before, and the result is still checked by the same schema,
 * so the request sent is exactly the one "accounts/{id}" would have sent.
 */
function destinationAccountName(input: string): string {
  const name = normaliseAccountName(input)
  return /^[A-Za-z0-9_-]+$/.test(name) ? `accounts/${name}` : name
}

/** Why a review couldn't be prepared: against the destination field, or for the whole request. */
type PreviewProblem = { readonly field?: string; readonly message?: string }

// Each eligibility refusal is raised before anything is saved
// (`requireEligibility` runs before the review is stored).
const NOTHING_SAVED = "No review was saved, and nothing was sent to Google."

/**
 * The server answers every eligibility refusal with one generic sentence;
 * its code says which check failed, so the dialog can say what to fix.
 */
function previewProblem(error: Error, destination?: string): PreviewProblem {
  const account = destination ?? "the destination account"
  if (!(error instanceof ApiClientError))
    return {
      message:
        "We couldn’t prepare the review. Nothing was sent to Google. Try again.",
    }
  switch (error.code) {
    case "destination_matches_source":
      return {
        field: `This is the account the location is in now. Enter the account it should move to. ${NOTHING_SAVED}`,
      }
    case "destination_access_unproven":
      return {
        field: `The connected Google login couldn’t fully read ${account}. Check the account ID and that the login can open that account. ${NOTHING_SAVED}`,
      }
    case "destination_management_required":
      return {
        field: `The connected Google login needs owner or manager access to ${account} before the location can move there. ${NOTHING_SAVED}`,
      }
    case "destination_already_contains_location":
      return {
        field: `${account} already holds this location. ${NOTHING_SAVED}`,
      }
    case "source_ownership_required":
      return {
        message: `Only an owner of the Google account that holds this location can transfer it, and the connected login isn’t an owner there. ${NOTHING_SAVED}`,
      }
    case "deletion_eligibility_unproven":
      return {
        message: `Google doesn’t list this location as one the connected login can delete. ${NOTHING_SAVED}`,
      }
    case "source_access_unknown":
    case "source_membership_unproven":
      return {
        message: `Google didn’t confirm that the connected login manages this location’s account. ${NOTHING_SAVED}`,
      }
    default:
      return { message: error.message }
  }
}

/**
 * Why a danger row's button is disabled. An ended location and a listing
 * name that hasn't loaded get a short reason of their own; the page's alert
 * already gives the long one.
 */
function DangerGateNote() {
  const section = useAdministrationSection(),
    workflow = useLifecycleContext()
  if (workflow?.ended)
    return (
      <GateNote reason="Not available: this account no longer manages this location." />
    )
  if (section.disabled || section.publishReason) return <SectionGateNote />
  if (!section.locationName)
    return (
      <GateNote reason="Not available until the listing name loads. Reload the page if this stays." />
    )
  return null
}

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
  // The format is checked once the person leaves the field or submits.
  const [touched, setTouched] = useState(false)
  // The last preview's refusal, shown in the dialog that asked for it.
  const [problem, setProblem] = useState<PreviewProblem | null>(null)
  const parsed = googleAccountNameSchema.safeParse(
    destinationAccountName(destination)
  )
  const listing = section.locationName || "this location"
  const destinationError =
    problem?.field ??
    (touched && destination.trim().length > 0 && !parsed.success
      ? DESTINATION_FORMAT_ERROR
      : undefined)
  const blocked =
    section.writeBlocked ||
    !section.locationName ||
    !workflow ||
    workflow.busy ||
    workflow.unresolved
  function showTransfer(next: boolean) {
    setCollecting(next)
    setProblem(null)
    if (!next) {
      setDestination("")
      setTouched(false)
    }
  }
  function openDeletion(next: boolean) {
    setDeleting(next)
    setProblem(null)
  }
  // Scoped: a refusal is explained here, and never marks a review that is
  // already open as stale.
  async function previewTransfer() {
    if (!workflow || !parsed.success) return
    const destinationAccount = parsed.data
    try {
      await workflow.preview(
        {
          operation: "transfer_location",
          payload: { destinationAccount },
        },
        { scoped: true }
      )
      showTransfer(false)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      setProblem(previewProblem(error, destinationAccount))
    }
  }
  async function previewDeletion() {
    if (!workflow) return
    try {
      await workflow.preview(
        { operation: "delete_location", payload: {} },
        { scoped: true }
      )
      openDeletion(false)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      // This dialog has no field, so every reason is said for the request.
      const { field, message } = previewProblem(error)
      setProblem({ message: message ?? field })
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
        description="Each request is checked with Google, saved as a review, approved, and only then sent. Google may reject a request, and NabaPresence can’t undo an accepted deletion."
      />
      <ul aria-label="Danger zone actions" className="flex min-w-0 flex-col">
        <SettingsRow
          className={ROW}
          label="Transfer this location"
          description={
            <>
              Move the exact Google location between accounts. Current source
              ownership and destination management access must be established.
              <DangerGateNote />
            </>
          }
          action={
            <Button
              variant="danger-outline"
              size="sm"
              disabled={blocked}
              onClick={() => showTransfer(true)}
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
              <DangerGateNote />
            </>
          }
          action={
            <Button
              variant="danger-outline"
              size="sm"
              disabled={blocked}
              onClick={() => openDeletion(true)}
            >
              Request deletion
            </Button>
          }
        />
      </ul>
      <Dialog
        open={collecting}
        onOpenChange={showTransfer}
        dirty={destination.trim().length > 0}
        onDiscard={() => {
          setDestination("")
          setTouched(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Transfer ${listing} to another Google account`}</DialogTitle>
            <DialogDescription>
              Enter the Google Business Profile account to move this location
              to. NabaPresence checks access in both accounts and saves a review
              for approval. Nothing is sent to Google at this step.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex min-w-0 flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              setTouched(true)
              if (!blocked && parsed.success) void previewTransfer()
            }}
          >
            <Field error={destinationError}>
              <FieldLabel htmlFor="lifecycle-destination">
                Destination Google account
              </FieldLabel>
              <Input
                id="lifecycle-destination"
                value={destination}
                onChange={(event) => {
                  setDestination(event.target.value)
                  setProblem(null)
                }}
                onBlur={() => setTouched(true)}
                // Enter can't submit while Continue is disabled, so it shows
                // the format error instead.
                onKeyDown={(event) => {
                  if (event.key === "Enter") setTouched(true)
                }}
                placeholder="accounts/…"
                disabled={workflow?.busy}
                {...inputHints.identifier}
              />
              <FieldDescription>
                The account ID, for example accounts/123456789 or just
                123456789.
              </FieldDescription>
              <FieldError />
            </Field>
            <FormError>{problem?.message}</FormError>
            <DialogFooter>
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
      <Dialog open={deleting} onOpenChange={openDeletion}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Request deletion of ${listing}`}</DialogTitle>
            <DialogDescription>
              NabaPresence checks with Google that this location can be deleted,
              then saves a review for approval. Nothing is deleted or sent to
              Google at this step. Even after deletion, the business and its
              customer reviews may stay on Search and Maps.
            </DialogDescription>
          </DialogHeader>
          <FormError>{problem?.message}</FormError>
          <DialogFooter>
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
