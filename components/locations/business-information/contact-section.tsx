"use client"

import { useId, type Dispatch, type SetStateAction } from "react"

import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { PayloadFieldErrors } from "@/lib/locations/business-information-draft"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"

/** Phone, website and the storefront address. */
export function ContactSection({
  draft,
  setDraft,
  issues,
  disabled,
}: {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  issues: PayloadFieldErrors
  disabled: boolean
}) {
  const addressId = useId()

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <h2 className="text-title font-semibold">Contact</h2>
      <Field error={issues.primaryPhone}>
        <FieldLabel>Phone</FieldLabel>
        <Input
          value={draft.primaryPhone}
          disabled={disabled}
          onChange={(e) =>
            setDraft((d) => ({ ...d, primaryPhone: e.target.value }))
          }
        />
        <FieldError />
      </Field>
      <Field error={issues.websiteUri}>
        <FieldLabel>Website</FieldLabel>
        <Input
          value={draft.websiteUri}
          disabled={disabled}
          inputMode="url"
          onChange={(e) =>
            setDraft((d) => ({ ...d, websiteUri: e.target.value }))
          }
        />
        <FieldError />
      </Field>
      <Field error={issues.addressLines}>
        <FieldLabel htmlFor={addressId}>Address lines</FieldLabel>
        <Textarea
          id={addressId}
          value={draft.addressLines.join("\n")}
          disabled={disabled}
          rows={3}
          placeholder="One line per address line"
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              addressLines: e.target.value
                .split("\n")
                .map((l) => l.trim())
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
          onChange={(e) =>
            setDraft((d) => ({ ...d, locality: e.target.value }))
          }
        />
      </Field>
      <Field>
        <FieldLabel>Postcode</FieldLabel>
        <Input
          value={draft.postalCode}
          disabled={disabled}
          onChange={(e) =>
            setDraft((d) => ({ ...d, postalCode: e.target.value }))
          }
        />
      </Field>
    </section>
  )
}
