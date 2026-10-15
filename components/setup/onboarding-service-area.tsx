"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input, inputHints } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  googleServiceAreaSchema,
  type GoogleServiceArea,
} from "@/lib/domain/google-service-area"
import {
  codeLabel,
  countryOptions,
  typedCountryCode,
  withCurrent,
} from "@/lib/setup/onboarding-codes"

import { CodeCombobox } from "./code-combobox"

export function OnboardingServiceArea({
  value,
  onChange,
  onEntryChange,
}: {
  value: GoogleServiceArea | undefined
  onChange: (value: GoogleServiceArea | undefined) => void
  onEntryChange: (dirty: boolean) => void
}) {
  const [name, setName] = useState("")
  const [placeId, setPlaceId] = useState("")
  const [error, setError] = useState<string>()
  const places = value?.places?.placeInfos ?? []
  // The country picker's list, with a saved code kept in it.
  const countryChoices = withCurrent(
    countryOptions(),
    value?.regionCode ?? "",
    "region"
  )
  const entryDirty = Boolean(name || placeId)
  useEffect(() => {
    onEntryChange(entryDirty)
    return () => onEntryChange(false)
  }, [entryDirty, onEntryChange])
  const reset = () => {
    setName("")
    setPlaceId("")
    setError(undefined)
  }
  const label = !value
    ? "At the business location only"
    : value.businessType === "CUSTOMER_LOCATION_ONLY"
      ? "At customer locations only"
      : "At business and customer locations"
  return (
    <div
      role="group"
      aria-label="Service-area business details"
      className="flex min-w-0 flex-col gap-3 sm:col-span-2"
    >
      <Field>
        <FieldLabel>Where do you meet customers?</FieldLabel>
        <Select
          value={value?.businessType ?? "storefront"}
          onValueChange={(next) => {
            if (next === "storefront") {
              onChange(undefined)
              reset()
            } else if (
              next === "CUSTOMER_LOCATION_ONLY" ||
              next === "CUSTOMER_AND_BUSINESS_LOCATION"
            )
              onChange({ ...value, businessType: next })
          }}
        >
          <SelectTrigger>
            <SelectValue>{label}</SelectValue>
          </SelectTrigger>
          <SelectContent title="Where do you meet customers?">
            <SelectItem value="storefront">
              At the business location only
            </SelectItem>
            <SelectItem value="CUSTOMER_LOCATION_ONLY">
              At customer locations only
            </SelectItem>
            <SelectItem value="CUSTOMER_AND_BUSINESS_LOCATION">
              At business and customer locations
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>
          Customer-only businesses need a service-area country and no storefront
          address. These choices describe the proposed listing.
        </FieldDescription>
      </Field>
      {value && (
        <>
          <Field>
            <FieldLabel>Service-area country code</FieldLabel>
            <CodeCombobox
              title="Service-area country"
              placeholder="Choose a country"
              value={value.regionCode ?? ""}
              options={countryChoices}
              typed={(text) => typedCountryCode(text, countryChoices)}
              label={(code) => codeLabel("region", code)}
              onValueChange={(code) =>
                onChange({
                  ...value,
                  regionCode: code.toUpperCase().trim() || undefined,
                })
              }
            />
            <FieldDescription>
              Two-letter country code, such as GB, or pick the country by name.
              Required for a customer-only business.
            </FieldDescription>
          </Field>
          <ul className="flex flex-col divide-y divide-line-subtle border-y border-line-subtle">
            {places.map((place) => (
              <li
                key={place.placeId}
                className="flex min-w-0 items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-body font-medium break-words text-ink">
                    {place.placeName}
                  </p>
                  <p className="font-mono text-caption break-all text-ink-muted">
                    {place.placeId}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={`Remove service area ${place.placeName}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      places: {
                        placeInfos: places.filter(
                          (entry) => entry.placeId !== place.placeId
                        ),
                      },
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-muted">
            {places.length} of 20 service areas in this draft.
          </p>
          {places.length < 20 && (
            <>
              <Field>
                <FieldLabel>Service area name</FieldLabel>
                <Input
                  value={name}
                  maxLength={255}
                  onChange={(event) => {
                    setName(event.target.value)
                    setError(undefined)
                  }}
                />
              </Field>
              <Field error={error}>
                <FieldLabel>Service area place ID</FieldLabel>
                <Input
                  {...inputHints.identifier}
                  value={placeId}
                  maxLength={255}
                  onChange={(event) => {
                    setPlaceId(event.target.value)
                    setError(undefined)
                  }}
                />
                <FieldError />
                <FieldDescription>
                  Enter an existing Google place ID from your authorised
                  records. Local checks validate format only. Google validates
                  the proposed areas before creation approval.
                </FieldDescription>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!name.trim() || !placeId.trim()}
                  onClick={() => {
                    const next = googleServiceAreaSchema.safeParse({
                      ...value,
                      places: {
                        placeInfos: [...places, { placeName: name, placeId }],
                      },
                    })
                    if (!next.success) {
                      setError(
                        next.error.issues[0]?.message ??
                          "Check the area name and place ID."
                      )
                      return
                    }
                    onChange(next.data)
                    reset()
                  }}
                >
                  Add service area
                </Button>
                {entryDirty && (
                  <Button type="button" variant="ghost" onClick={reset}>
                    Discard area entry
                  </Button>
                )}
              </div>
              {entryDirty && (
                <p role="status" className="text-caption text-ink-muted">
                  Add this area or discard its entry before saving or searching.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
