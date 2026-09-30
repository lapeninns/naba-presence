"use client"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { openStatusLabel } from "@/lib/locations/console-labels"
import type { OnboardingOpeningDraft } from "@/lib/locations/onboarding-opening"

export function OnboardingOpening({
  value,
  onChange,
  error,
}: {
  value: OnboardingOpeningDraft
  onChange: (value: OnboardingOpeningDraft) => void
  error?: string
}) {
  return (
    <div
      role="group"
      aria-label="Opening information"
      className="flex min-w-0 flex-col gap-3 sm:col-span-2"
    >
      <Field>
        <FieldLabel>Opening state</FieldLabel>
        <Select
          value={value.status}
          onValueChange={(status) => {
            if (status === "omit") onChange({ status, date: null })
            else if (
              status === "OPEN" ||
              status === "CLOSED_TEMPORARILY" ||
              status === "CLOSED_PERMANENTLY"
            )
              onChange({ ...value, status })
          }}
        >
          <SelectTrigger>
            <SelectValue>
              {value.status === "omit"
                ? "Not supplied in this proposal"
                : openStatusLabel(value.status)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="omit">Not supplied in this proposal</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="CLOSED_TEMPORARILY">
              Temporarily closed
            </SelectItem>
            <SelectItem value="CLOSED_PERMANENTLY">
              Permanently closed
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>
          This is the proposed business state, separate from opening hours.
          Google defaults new locations to open when this is omitted. Saving
          this draft does not close an existing business.
        </FieldDescription>
      </Field>
      {value.date ? (
        <>
          <p className="text-caption text-ink-muted">
            Enter the month and year the business first opened. Leave the day
            blank if unknown. Dates can be no more than one year in the future.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {(["day", "month", "year"] as const).map((part) => (
              <Field key={part}>
                <FieldLabel>
                  {part === "day"
                    ? "Opening day (optional)"
                    : part === "month"
                      ? "Opening month"
                      : "Opening year"}
                </FieldLabel>
                <Input
                  value={value.date?.[part] ?? ""}
                  inputMode="numeric"
                  maxLength={part === "year" ? 4 : 2}
                  aria-invalid={Boolean(error)}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      date: {
                        ...(value.date ?? { year: "", month: "", day: "" }),
                        [part]: event.target.value,
                      },
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() => onChange({ ...value, date: null })}
          >
            Clear opening date from proposal
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={value.status === "omit"}
          onClick={() =>
            onChange({ ...value, date: { year: "", month: "", day: "" } })
          }
        >
          Add opening date
        </Button>
      )}
      {value.status === "omit" && (
        <p className="text-caption text-ink-muted">
          Choose an opening state before adding a date.
        </p>
      )}
      {error && (
        <p role="alert" className="text-ui text-danger-ink">
          {error}
        </p>
      )}
    </div>
  )
}
