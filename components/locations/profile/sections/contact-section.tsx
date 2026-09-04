"use client"

import { useId, type Dispatch, type SetStateAction } from "react"

import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { PayloadFieldErrors } from "@/lib/locations/business-information-draft"
import type { ProfileFormValues } from "@/lib/locations/forms/profile"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"

/** How customers reach the business: phone, website, and where it is. */
export function ContactSection({
  values,
  setValues,
  draft,
  setDraft,
  errors,
  issues,
  disabled,
  googleReady,
}: {
  values: ProfileFormValues
  setValues: Dispatch<SetStateAction<ProfileFormValues>>
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  errors: Partial<Record<keyof ProfileFormValues, string>>
  issues: PayloadFieldErrors
  disabled: boolean
  /** False while Google's half of the listing has not arrived. */
  googleReady: boolean
}) {
  const addressId = useId()

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <h3 className="text-title font-medium">Contact</h3>

      <Field error={errors.phone}>
        <FieldLabel>Phone</FieldLabel>
        <Input
          value={values.phone}
          disabled={disabled}
          onChange={(event) =>
            setValues((v) => ({ ...v, phone: event.target.value }))
          }
        />
        <FieldError />
      </Field>

      <Field error={errors.website}>
        <FieldLabel>Website</FieldLabel>
        <Input
          value={values.website}
          disabled={disabled}
          inputMode="url"
          onChange={(event) =>
            setValues((v) => ({ ...v, website: event.target.value }))
          }
        />
        <FieldError />
      </Field>

      {googleReady ? (
        <>
          <Field error={issues.addressLines}>
            <FieldLabel htmlFor={addressId}>Address lines</FieldLabel>
            <Textarea
              id={addressId}
              value={draft.addressLines.join("\n")}
              disabled={disabled}
              rows={3}
              placeholder="One line per address line"
              onChange={(event) =>
                setDraft((d) => ({
                  ...d,
                  addressLines: event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                }))
              }
            />
            <FieldError />
          </Field>

          <Field>
            <FieldLabel>Town or city</FieldLabel>
            <Input
              value={draft.locality}
              disabled={disabled}
              onChange={(event) =>
                setDraft((d) => ({ ...d, locality: event.target.value }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Postcode</FieldLabel>
            <Input
              value={draft.postalCode}
              disabled={disabled}
              onChange={(event) =>
                setDraft((d) => ({ ...d, postalCode: event.target.value }))
              }
            />
          </Field>
        </>
      ) : null}
    </section>
  )
}
