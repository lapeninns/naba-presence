"use client"

import type { Dispatch, SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  useFieldContext,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"

const PARTS = [
  { key: "day", label: "Day (optional)", maxLength: 2 },
  { key: "month", label: "Month", maxLength: 2 },
  { key: "year", label: "Year", maxLength: 4 },
] as const

/**
 * When the business first opened: day (optional), month and year as numbers.
 * The hint and any error belong to the whole date, so they sit on one Field
 * around the group and every part is described by them.
 */
export function OpeningDateFields({
  draft,
  setDraft,
  disabled,
  error,
}: {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  disabled: boolean
  error?: string
}) {
  return (
    <Field error={error}>
      <OpeningDateGroup
        draft={draft}
        setDraft={setDraft}
        disabled={disabled}
        error={error}
      />
    </Field>
  )
}

function OpeningDateGroup({
  draft,
  setDraft,
  disabled,
  error,
}: {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  disabled: boolean
  error?: string
}) {
  const field = useFieldContext()
  const describedBy = [error ? field?.errorId : null, field?.descriptionId]
    .filter(Boolean)
    .join(" ")
  const date = draft.openingDate
  return (
    <fieldset
      id="profile-opening-date"
      className="flex min-w-0 flex-col gap-3"
      disabled={disabled}
      aria-describedby={describedBy || undefined}
    >
      <legend className="text-ui font-semibold text-ink">Opening date</legend>
      <FieldDescription>
        When the business first opened. Enter a month and year; leave the day
        blank if unknown.
      </FieldDescription>
      {date ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {PARTS.map((part) => (
              <Field key={part.key}>
                <FieldLabel>{part.label}</FieldLabel>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={part.maxLength}
                  value={
                    part.key === "day" && date.day === "0" ? "" : date[part.key]
                  }
                  aria-invalid={Boolean(error)}
                  onChange={(event) => {
                    const value = event.target.value
                    setDraft((current) => ({
                      ...current,
                      openingDate: {
                        ...(current.openingDate ?? {
                          year: "",
                          month: "",
                          day: "",
                        }),
                        [part.key]: value,
                      },
                    }))
                  }}
                />
              </Field>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() =>
              setDraft((current) => ({ ...current, openingDate: null }))
            }
          >
            Clear opening date
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              openingDate: { year: "", month: "", day: "" },
            }))
          }
        >
          Add opening date
        </Button>
      )}
      <FieldError />
    </fieldset>
  )
}
