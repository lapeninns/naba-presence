"use client"

import Link from "next/link"
import { useRef, useState, type Dispatch, type SetStateAction } from "react"

import {
  LabelRow,
  SectionCard,
} from "@/components/locations/profile/section-card"
import {
  OptionRow,
  OptionRowGroup,
  OptionSeparator,
} from "@/components/ui/option-row"
import { SettingsRow } from "@/components/ui/settings-row"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { PROFILE_FIELD_IDS } from "@/components/locations/profile/sections/identity-section"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  OPEN_STATUS_OPTIONS,
  type PayloadFieldErrors,
} from "@/lib/locations/business-information-draft"
import { useBreakpoint } from "@/lib/hooks/use-media-query"
import { openStatusLabel } from "@/lib/locations/console-labels"
import type { ProfileFormValues } from "@/lib/locations/forms/profile"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"
import { cn } from "@/lib/utils"
import { useWorkspaceTerms } from "@/lib/workspace/mode"
import { OpeningDateFields } from "./opening-date-fields"
import { AddressDetailsFields } from "./address-details-fields"

type ValuesProps = {
  values: ProfileFormValues
  setValues: Dispatch<SetStateAction<ProfileFormValues>>
  errors: Partial<Record<keyof ProfileFormValues, string>>
  disabled: boolean
}

/** How customers reach the business from Search and Maps. */
export function ContactSection({
  values,
  setValues,
  errors,
  disabled,
  changed,
  marks,
}: ValuesProps & {
  changed: { phone: boolean; website: boolean }
  /** Whose change each row's word names; falls back to "Changed". */
  marks?: { phone?: string; website?: string }
}) {
  return (
    <SectionCard
      id="section-contact"
      title="Contact"
      description="How customers reach the business from Search and Maps."
      changed={changed.phone || changed.website}
    >
      <SettingsRow
        label="Phone"
        controlId={PROFILE_FIELD_IDS.phone}
        changed={changed.phone ? (marks?.phone ?? "Changed") : undefined}
        control={
          <Field error={errors.phone}>
            <Input
              id={PROFILE_FIELD_IDS.phone}
              type="tel"
              value={values.phone}
              disabled={disabled}
              inputMode="tel"
              autoComplete="tel"
              onChange={(event) =>
                setValues((v) => ({ ...v, phone: event.target.value }))
              }
            />
            <FieldDescription>With the area code.</FieldDescription>
            <FieldError />
          </Field>
        }
      />
      <SettingsRow
        label="Website"
        controlId={PROFILE_FIELD_IDS.website}
        changed={changed.website ? (marks?.website ?? "Changed") : undefined}
        control={
          <Field error={errors.website}>
            <Input
              id={PROFILE_FIELD_IDS.website}
              type="url"
              value={values.website}
              disabled={disabled}
              inputMode="url"
              autoComplete="url"
              onChange={(event) =>
                setValues((v) => ({ ...v, website: event.target.value }))
              }
            />
            <FieldDescription>
              A full address, starting with https://
            </FieldDescription>
            <FieldError />
          </Field>
        }
      />
    </SectionCard>
  )
}

function addressLinesOf(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Where customers find the business. Moving the map pin happens in Google. */
export function AddressSection({
  location,
  draft,
  setDraft,
  issues,
  disabled,
  changed,
}: {
  location?: unknown
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  issues: PayloadFieldErrors
  disabled: boolean
  changed: {
    lines: boolean
    locality: boolean
    postalCode: boolean
    administrativeArea?: boolean
    sublocality?: boolean
    addressDetails?: boolean
  }
}) {
  // The textarea keeps what the operator typed (a trailing space, a new empty
  // line) while the draft keeps only the clean lines. Rendering the cleaned
  // lines straight back into the textarea ate every space typed at the end of
  // a line and every Enter, so "High Street" could not be typed. A change from
  // outside (discard, a new revision) resets the text.
  const joined = draft.addressLines.join("\n")
  const [text, setText] = useState(joined)
  if (addressLinesOf(text).join("\n") !== joined) setText(joined)
  return (
    <SectionCard
      id="section-address"
      title="Address"
      description="Where customers find the business. Moving the map pin happens in Google."
      changed={
        changed.lines ||
        changed.locality ||
        changed.postalCode ||
        changed.administrativeArea ||
        changed.sublocality ||
        changed.addressDetails
      }
    >
      {/* Inline, not a sheet: these fields are pinned in place across
          widths, and their edits apply to the draft as they are typed
          (a sheet would add a Done step the address never had). */}
      <SettingsRow
        label="Address lines"
        controlId={PROFILE_FIELD_IDS.address}
        changed={changed.lines ? "Changed" : undefined}
        control={
          <Field error={issues.addressLines}>
            <Textarea
              id={PROFILE_FIELD_IDS.address}
              value={text}
              disabled={disabled}
              rows={3}
              autoComplete="street-address"
              onChange={(event) => {
                const raw = event.target.value
                setText(raw)
                setDraft((d) => ({ ...d, addressLines: addressLinesOf(raw) }))
              }}
            />
            <FieldDescription>One line per address line.</FieldDescription>
            <FieldError />
          </Field>
        }
      />
      <SettingsRow
        label="Town or city"
        controlId="profile-locality"
        changed={changed.locality ? "Changed" : undefined}
        control={
          <Field>
            <Input
              id="profile-locality"
              value={draft.locality}
              disabled={disabled}
              autoComplete="address-level2"
              onChange={(event) =>
                setDraft((d) => ({ ...d, locality: event.target.value }))
              }
            />
          </Field>
        }
      />
      <SettingsRow
        label="Postcode"
        controlId="profile-postal-code"
        changed={changed.postalCode ? "Changed" : undefined}
        control={
          <Field>
            <Input
              id="profile-postal-code"
              value={draft.postalCode}
              disabled={disabled}
              autoComplete="postal-code"
              onChange={(event) =>
                setDraft((d) => ({ ...d, postalCode: event.target.value }))
              }
            />
          </Field>
        }
      />
      <SettingsRow
        label="District or neighbourhood (optional)"
        controlId="profile-sublocality"
        changed={changed.sublocality ? "Changed" : undefined}
        control={
          <Field error={issues.sublocality}>
            <Input
              id="profile-sublocality"
              value={draft.sublocality ?? ""}
              maxLength={100}
              disabled={disabled}
              autoComplete="address-level3"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  sublocality: event.target.value,
                }))
              }
            />
            <FieldDescription>
              Use only when it is part of your postal address. Leave blank to
              remove an existing value.
            </FieldDescription>
            <FieldError />
          </Field>
        }
      />
      <SettingsRow
        label="County or region (optional)"
        controlId="profile-administrative-area"
        changed={changed.administrativeArea ? "Changed" : undefined}
        control={
          <Field error={issues.administrativeArea}>
            <Input
              id="profile-administrative-area"
              value={draft.administrativeArea ?? ""}
              maxLength={100}
              disabled={disabled}
              autoComplete="address-level1"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  administrativeArea: event.target.value,
                }))
              }
            />
            <FieldDescription>
              Not needed for a UK address. Leave it as it is unless it’s wrong.
            </FieldDescription>
            <FieldError />
          </Field>
        }
      />
      <AddressDetailsFields
        draft={draft}
        setDraft={setDraft}
        location={location}
        disabled={disabled}
        error={issues.addressDetails}
      />
    </SectionCard>
  )
}

const DESCRIPTION_LIMIT = 750

/** What makes the place worth a visit, in the business's own words. */
export function DescriptionSection({
  values,
  setValues,
  errors,
  disabled,
  changed,
  mark,
}: ValuesProps & {
  changed: boolean
  /** Whose change the row's word names; falls back to "Changed". */
  mark?: string
}) {
  const length = values.description.length
  const over = length > DESCRIPTION_LIMIT
  return (
    <SectionCard
      id="section-description"
      title="Description"
      description="What makes the place worth a visit, in its own words. No links or offers."
      changed={changed}
    >
      <SettingsRow
        label="Description"
        controlId={PROFILE_FIELD_IDS.description}
        changed={changed ? (mark ?? "Changed") : undefined}
        // The count describes the field and is read on focus. Read on
        // every keystroke it was noise; only crossing the limit is news.
        description={
          <span
            className={cn(
              "tabular-nums",
              over ? "font-semibold text-danger-ink" : "text-ink-muted"
            )}
          >
            {length.toLocaleString("en-GB")} / {DESCRIPTION_LIMIT}
          </span>
        }
        control={
          <Field error={errors.description}>
            <Textarea
              id={PROFILE_FIELD_IDS.description}
              value={values.description}
              disabled={disabled}
              rows={5}
              onChange={(event) =>
                setValues((v) => ({ ...v, description: event.target.value }))
              }
            />
            <FieldError />
            <span role="status" className="sr-only">
              {over
                ? `Over Google’s ${DESCRIPTION_LIMIT}-character limit.`
                : ""}
            </span>
          </Field>
        }
      />
    </SectionCard>
  )
}

/**
 * Whether the business is trading. Choosing "Permanently closed" asks for a
 * confirmation first: once published, Google stops showing hours and booking
 * buttons and the listing drops out of most searches.
 */
export function OpeningSection({
  locationId,
  draft,
  setDraft,
  issues,
  disabled,
  changed,
  statusChanged,
}: {
  locationId: string
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  issues: PayloadFieldErrors
  disabled: boolean
  changed: boolean
  statusChanged: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [ack, setAck] = useState(false)
  // An agency confirms with its client; a business owner confirms it
  // themselves, so business mode never says "client".
  const terms = useWorkspaceTerms()
  // The confirmation opens from a choice in the list, not from a button, so
  // it has no trigger of its own to hand focus back to; send it to the
  // status control instead of letting it fall to the page.
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The phone's status row (a settings row has no ref of its own).
  const rowRef = useRef<HTMLDivElement>(null)
  // The desk keeps the Select; a phone picks from an inset sheet.
  const desk = useBreakpoint("desk")
  const [picking, setPicking] = useState(false)
  // "Permanently closed" from the sheet: confirm once the sheet has closed
  // and handed focus back, so the alert dialog takes focus last.
  const confirmAfterSheet = useRef(false)
  /** The Select's and the sheet's choice: the same rule for both. */
  const choose = (value: string) => {
    if (value === "CLOSED_PERMANENTLY") {
      setAck(false)
      setConfirming(true)
      return
    }
    setDraft((d) => ({ ...d, openStatus: value }))
  }
  return (
    <SectionCard
      id="section-opening"
      title="Opening state"
      description={
        <>
          Whether the business is trading. Day-to-day times live in{" "}
          <Link
            href={`/listings/${locationId}/hours`}
            className="font-medium text-accent-ink underline underline-offset-3 focus-halo hover:decoration-2"
          >
            Opening hours
          </Link>
          .
        </>
      }
      changed={changed}
    >
      {desk ? (
        // A Field like every other control on this page, so the Select's
        // trigger takes the Field's label, invalid state and error wiring.
        <Field>
          <LabelRow changed={statusChanged}>
            <FieldLabel>Open status</FieldLabel>
          </LabelRow>
          <Select
            value={draft.openStatus}
            onValueChange={(value: string | null) => {
              if (value) choose(value)
            }}
            disabled={disabled}
          >
            <SelectTrigger ref={triggerRef} className="w-full sm:w-72">
              {/* Render function so the trigger reads the humanised label on
                  first paint, before the popup's items have registered. */}
              <SelectValue>
                {(value: string | null) =>
                  value ? openStatusLabel(value) : ""
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent title="Open status">
              {OPEN_STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>
                  {openStatusLabel(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError />
        </Field>
      ) : (
        // A phone: a settings row with the status, opening an inset sheet
        // of the choices; "Permanently closed" is last, after a hairline,
        // in the danger ink, and still asks for the confirmation below.
        <div ref={rowRef} className="min-w-0">
          <SettingsRow
            label="Open status"
            changed={statusChanged ? "Changed" : undefined}
            value={openStatusLabel(draft.openStatus)}
            disabled={disabled}
            onClick={() => setPicking(true)}
          />
          <Sheet
            open={picking}
            onOpenChange={setPicking}
            onOpenChangeComplete={(open) => {
              if (open || !confirmAfterSheet.current) return
              confirmAfterSheet.current = false
              choose("CLOSED_PERMANENTLY")
            }}
          >
            <SheetContent
              variant="inset"
              // Back to the row that opened it: a tap in Safari never
              // focuses a button, so the default would land on <body>.
              finalFocus={() =>
                rowRef.current?.querySelector<HTMLElement>("button") ?? true
              }
            >
              <SheetHeader>
                <SheetTitle>Open status</SheetTitle>
              </SheetHeader>
              <SheetBody>
                <OptionRowGroup label="Open status" applyOnChoose>
                  {OPEN_STATUS_OPTIONS.filter(
                    (status) => status !== "CLOSED_PERMANENTLY"
                  ).map((status) => (
                    <OptionRow
                      key={status}
                      indicator="check"
                      selected={draft.openStatus === status}
                      label={openStatusLabel(status)}
                      onClick={() => {
                        setPicking(false)
                        if (status !== draft.openStatus) choose(status)
                      }}
                    />
                  ))}
                  {OPEN_STATUS_OPTIONS.includes("CLOSED_PERMANENTLY") ? (
                    <>
                      <OptionSeparator />
                      <OptionRow
                        indicator="check"
                        tone="destructive"
                        selected={draft.openStatus === "CLOSED_PERMANENTLY"}
                        label={openStatusLabel("CLOSED_PERMANENTLY")}
                        onClick={() => {
                          confirmAfterSheet.current =
                            draft.openStatus !== "CLOSED_PERMANENTLY"
                          setPicking(false)
                        }}
                      />
                    </>
                  ) : null}
                </OptionRowGroup>
              </SheetBody>
            </SheetContent>
          </Sheet>
        </div>
      )}

      <OpeningDateFields
        draft={draft}
        setDraft={setDraft}
        disabled={disabled}
        error={issues.openingDate}
      />
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          finalFocus={() =>
            desk
              ? triggerRef.current
              : (rowRef.current?.querySelector<HTMLElement>("button") ?? null)
          }
        >
          <AlertDialogTitle>Mark as permanently closed?</AlertDialogTitle>
          <AlertDialogDescription>
            When you publish, Google shows “Permanently closed” on Search and
            Maps. Customers stop seeing opening hours and booking buttons, and
            the listing drops out of most searches.
          </AlertDialogDescription>
          <Alert variant="destructive" role="note">
            <AlertDescription>
              Reopening later needs another publish, and Google may take days to
              show the listing as open again. For a refurbishment or a season,
              choose Temporarily closed instead.
            </AlertDescription>
          </Alert>
          <Checkbox
            checked={ack}
            onCheckedChange={(value) => setAck(value === true)}
            label={
              terms.mode === "agency"
                ? "I’ve confirmed with the client that this business has closed for good."
                : "I’ve confirmed that this business has closed for good."
            }
            labelClassName="text-ui"
          />
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>
              Keep current status
            </AlertDialogClose>
            <Button
              variant="danger"
              disabled={!ack}
              onClick={() => {
                setDraft((d) => ({ ...d, openStatus: "CLOSED_PERMANENTLY" }))
                setConfirming(false)
              }}
            >
              Mark as permanently closed
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  )
}
