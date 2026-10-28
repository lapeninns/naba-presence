"use client"

import { useId, type HTMLAttributes } from "react"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  Fieldset,
  FieldsetDescription,
  FieldsetLegend,
} from "@/components/ui/fieldset"
import { Input, inputHints } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { VerificationOptionsInput } from "@/lib/contracts/google-verification-options"
import {
  verificationLanguageName,
  verificationRegionName,
} from "./verification-method"

export function VerificationTextField({
  label,
  value,
  onChange,
  disabled,
  hint,
  readOnly,
  maxLength,
  inputMode,
  autoCapitalize,
  autoCorrect,
  spellCheck,
  enterKeyHint,
  autoComplete = "off",
  error,
  onBlur,
}: {
  readonly label: string
  readonly value: string
  readonly onChange?: (value: string) => void
  readonly disabled?: boolean
  readonly hint?: string
  readonly readOnly?: boolean
  readonly maxLength?: number
  readonly inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"]
  readonly autoCapitalize?: string
  readonly autoCorrect?: string
  readonly spellCheck?: boolean
  readonly enterKeyHint?: HTMLAttributes<HTMLInputElement>["enterKeyHint"]
  readonly autoComplete?: string
  /** Shown under the field, and marks it invalid, once the caller decides it should be. */
  readonly error?: string
  readonly onBlur?: () => void
}) {
  const id = useId()
  return (
    <Field error={error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={maxLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        enterKeyHint={enterKeyHint}
      />
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError announce="polite" />
    </Field>
  )
}

type Address = NonNullable<VerificationOptionsInput["context"]>["address"]

/** Per-field reasons the address cannot be checked yet, already filtered to fields the person has left. */
export type VerificationAddressErrors = {
  readonly addressLines?: string
  readonly regionCode?: string
  readonly addressLanguage?: string
  readonly recipients?: string
  /** A problem no single field owns. */
  readonly address?: string
}
// The address as people write it; the codes Google needs come last.
const placeFields = [
  ["locality", "Town or city"],
  ["administrativeArea", "County or region"],
  ["postalCode", "Postcode"],
  ["sublocality", "Neighbourhood"],
  ["organization", "Organisation"],
] as const

export function VerificationContextFields({
  value,
  disabled,
  onChange,
  errors = {},
  onFieldBlur,
}: {
  readonly value: Address
  readonly disabled: boolean
  readonly onChange: (value: Address) => void
  readonly errors?: VerificationAddressErrors
  readonly onFieldBlur?: (
    field: Exclude<keyof VerificationAddressErrors, "address">
  ) => void
}) {
  const linesId = useId(),
    recipientsId = useId()
  const country = verificationRegionName(value.regionCode),
    language = verificationLanguageName(value.languageCode)
  return (
    <Fieldset disabled={disabled}>
      <FieldsetLegend>Private service-business address</FieldsetLegend>
      <FieldsetDescription>
        Use the real address Google requires to offer verification methods. This
        is verification context, not a public profile address change.
      </FieldsetDescription>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field className="sm:col-span-2" error={errors.addressLines}>
          <FieldLabel htmlFor={linesId}>Street address</FieldLabel>
          <Textarea
            id={linesId}
            value={value.addressLines.join("\n")}
            onChange={(event) =>
              onChange({
                ...value,
                addressLines: event.target.value.split("\n"),
              })
            }
            onBlur={() => onFieldBlur?.("addressLines")}
            autoComplete="off"
            autoCapitalize="words"
          />
          <FieldDescription>
            One address line per line; up to five.
          </FieldDescription>
          <FieldError announce="polite" />
        </Field>
        {placeFields.map(([key, label]) => (
          <VerificationTextField
            key={key}
            label={label}
            value={value[key] ?? ""}
            onChange={(text) =>
              onChange({ ...value, [key]: text || undefined })
            }
            maxLength={key === "postalCode" ? 40 : 200}
            autoCapitalize={key === "postalCode" ? "characters" : "words"}
            spellCheck={key === "postalCode" ? false : undefined}
          />
        ))}
        <Field className="sm:col-span-2" error={errors.recipients}>
          <FieldLabel htmlFor={recipientsId}>Address recipients</FieldLabel>
          <Textarea
            id={recipientsId}
            value={value.recipients?.join("\n") ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                recipients: event.target.value
                  ? event.target.value.split("\n")
                  : undefined,
              })
            }
            onBlur={() => onFieldBlur?.("recipients")}
            autoComplete="off"
            autoCapitalize="words"
          />
          <FieldDescription>Optional; one recipient per line.</FieldDescription>
          <FieldError announce="polite" />
        </Field>
        <VerificationTextField
          label="Country code"
          value={value.regionCode}
          maxLength={2}
          onChange={(regionCode) =>
            onChange({ ...value, regionCode: regionCode.toUpperCase() })
          }
          onBlur={() => onFieldBlur?.("regionCode")}
          error={errors.regionCode}
          {...inputHints.identifier}
          autoCapitalize="characters"
          hint={
            country
              ? `${country}. Two-letter country code.`
              : "Two-letter country code, for example GB."
          }
        />
        <VerificationTextField
          label="Address language"
          value={value.languageCode ?? ""}
          onChange={(languageCode) =>
            onChange({ ...value, languageCode: languageCode || undefined })
          }
          onBlur={() => onFieldBlur?.("addressLanguage")}
          error={errors.addressLanguage}
          {...inputHints.identifier}
          hint={
            language
              ? `${language}. Optional language tag.`
              : "Optional language tag, for example en-GB."
          }
        />
        <VerificationTextField
          label="Sorting code"
          value={value.sortingCode ?? ""}
          onChange={(sortingCode) =>
            onChange({ ...value, sortingCode: sortingCode || undefined })
          }
          maxLength={40}
          {...inputHints.identifier}
        />
      </div>
    </Fieldset>
  )
}
