"use client"

import Link from "next/link"
import { useRef, useState, type Dispatch, type SetStateAction } from "react"

import {
  LabelRow,
  SectionCard,
} from "@/components/locations/profile/section-card"
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
import { openStatusLabel } from "@/lib/locations/console-labels"
import type { ProfileFormValues } from "@/lib/locations/forms/profile"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"
import { cn } from "@/lib/utils"

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
}: ValuesProps & { changed: { phone: boolean; website: boolean } }) {
  return (
    <SectionCard
      id="section-contact"
      title="Contact"
      description="How customers reach the business from Search and Maps."
      changed={changed.phone || changed.website}
    >
      <div className="grid grid-cols-1 gap-4 @[600px]/profile-body:grid-cols-2">
        <Field error={errors.phone}>
          <LabelRow changed={changed.phone}>
            <FieldLabel htmlFor={PROFILE_FIELD_IDS.phone}>Phone</FieldLabel>
          </LabelRow>
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

        <Field error={errors.website}>
          <LabelRow changed={changed.website}>
            <FieldLabel htmlFor={PROFILE_FIELD_IDS.website}>Website</FieldLabel>
          </LabelRow>
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
      </div>
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
  draft,
  setDraft,
  issues,
  disabled,
  changed,
}: {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  issues: PayloadFieldErrors
  disabled: boolean
  changed: { lines: boolean; locality: boolean; postalCode: boolean }
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
      changed={changed.lines || changed.locality || changed.postalCode}
    >
      <div className="grid grid-cols-1 gap-4 @[600px]/profile-body:grid-cols-2">
        <Field
          error={issues.addressLines}
          className="@[600px]/profile-body:col-span-2"
        >
          <LabelRow changed={changed.lines}>
            <FieldLabel htmlFor={PROFILE_FIELD_IDS.address}>
              Address lines
            </FieldLabel>
          </LabelRow>
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

        <Field>
          <LabelRow changed={changed.locality}>
            <FieldLabel>Town or city</FieldLabel>
          </LabelRow>
          <Input
            value={draft.locality}
            disabled={disabled}
            autoComplete="address-level2"
            onChange={(event) =>
              setDraft((d) => ({ ...d, locality: event.target.value }))
            }
          />
        </Field>

        <Field>
          <LabelRow changed={changed.postalCode}>
            <FieldLabel>Postcode</FieldLabel>
          </LabelRow>
          <Input
            value={draft.postalCode}
            disabled={disabled}
            autoComplete="postal-code"
            onChange={(event) =>
              setDraft((d) => ({ ...d, postalCode: event.target.value }))
            }
          />
        </Field>
      </div>
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
}: ValuesProps & { changed: boolean }) {
  const length = values.description.length
  const over = length > DESCRIPTION_LIMIT
  return (
    <SectionCard
      id="section-description"
      title="Description"
      description="What makes the place worth a visit, in its own words. No links or offers."
      changed={changed}
    >
      <Field error={errors.description}>
        <LabelRow
          changed={changed}
          extra={
            <span
              aria-live="polite"
              className={cn(
                "font-mono text-caption tabular-nums",
                over ? "font-semibold text-danger-ink" : "text-ink-muted"
              )}
            >
              {length.toLocaleString("en-GB")} / {DESCRIPTION_LIMIT}
            </span>
          }
        >
          <FieldLabel htmlFor={PROFILE_FIELD_IDS.description}>
            Description
          </FieldLabel>
        </LabelRow>
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
      </Field>
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
}: {
  locationId: string
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  issues: PayloadFieldErrors
  disabled: boolean
  changed: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [ack, setAck] = useState(false)
  // The confirmation opens from a choice in the list, not from a button, so
  // it has no trigger of its own to hand focus back to; send it to the
  // status control instead of letting it fall to the page.
  const triggerRef = useRef<HTMLButtonElement>(null)
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
      {/* A Field like every other control on this page, so the Select's
          trigger takes the Field's label, invalid state and error wiring. */}
      <Field error={issues.title}>
        <LabelRow changed={changed}>
          <FieldLabel>Open status</FieldLabel>
        </LabelRow>
        <Select
          value={draft.openStatus}
          onValueChange={(value: string | null) => {
            if (!value) return
            if (value === "CLOSED_PERMANENTLY") {
              setAck(false)
              setConfirming(true)
              return
            }
            setDraft((d) => ({ ...d, openStatus: value }))
          }}
          disabled={disabled}
        >
          <SelectTrigger ref={triggerRef} className="w-full sm:w-72">
            {/* Render function so the trigger reads the humanised label on
                first paint, before the popup's items have registered. */}
            <SelectValue>
              {(value: string | null) => (value ? openStatusLabel(value) : "")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {OPEN_STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {openStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError />
      </Field>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent finalFocus={triggerRef}>
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
            label="I’ve confirmed with the client that this business has closed for good."
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
