"use client"

import { useId, type Dispatch, type SetStateAction } from "react"

import { CategorySearch } from "@/components/locations/business-information/category-search"
import { Badge } from "@/components/ui/badge"
import { RemovableChip } from "@/components/ui/chip"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
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
import { categoryLabel, openStatusLabel } from "@/lib/locations/console-labels"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"
import type { ProfileFormValues } from "@/lib/locations/forms/profile"

/**
 * Who this business is: the name and description customers read, then the
 * categories and status Google files it under.
 *
 * Name and description are the NabaPresence copy — the one Google gets when
 * this publishes — so they are edited once here, not again under a second tab
 * holding Google's version of the same two fields.
 */
export function IdentitySection({
  locationId,
  values,
  setValues,
  draft,
  setDraft,
  errors,
  issues,
  disabled,
  googleReady,
}: {
  locationId: string
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
  const labelsId = useId()
  const openStatusLabelId = useId()

  return (
    <section className="flex max-w-2xl flex-col gap-4 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
      <h3 className="text-title font-semibold text-ink">Identity</h3>

      <Field error={errors.name}>
        <FieldLabel>Business name</FieldLabel>
        <Input
          value={values.name}
          disabled={disabled}
          onChange={(event) =>
            setValues((v) => ({ ...v, name: event.target.value }))
          }
        />
        <FieldError />
      </Field>

      <Field error={errors.description}>
        <FieldLabel>Description</FieldLabel>
        <Textarea
          value={values.description}
          disabled={disabled}
          rows={4}
          onChange={(event) =>
            setValues((v) => ({ ...v, description: event.target.value }))
          }
        />
        <FieldError />
      </Field>

      {googleReady ? (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-ui font-medium text-ink">
              Primary category
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {draft.primaryCategory ? (
                <Badge variant="tinted">
                  {categoryLabel(draft.primaryCategory)}
                </Badge>
              ) : (
                <span className="text-caption text-ink-muted">
                  No primary category set.
                </span>
              )}
            </div>
            <CategorySearch
              locationId={locationId}
              label="Change primary category"
              disabled={disabled}
              onSelect={(category) =>
                setDraft((d) => ({ ...d, primaryCategory: category }))
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-ui font-medium text-ink">
              Additional categories
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {draft.additionalCategories.length === 0 ? (
                <span className="text-caption text-ink-muted">None set.</span>
              ) : (
                draft.additionalCategories.map((category) =>
                  disabled ? (
                    <Badge key={category.name} variant="secondary">
                      {categoryLabel(category)}
                    </Badge>
                  ) : (
                    <RemovableChip
                      key={category.name}
                      removeLabel={`Remove ${categoryLabel(category)}`}
                      onRemove={() =>
                        setDraft((d) => ({
                          ...d,
                          additionalCategories: d.additionalCategories.filter(
                            (c) => c.name !== category.name
                          ),
                        }))
                      }
                    >
                      {categoryLabel(category)}
                    </RemovableChip>
                  )
                )
              )}
            </div>
            <CategorySearch
              locationId={locationId}
              label="Add another category"
              disabled={disabled}
              onSelect={(category) =>
                setDraft((d) =>
                  d.primaryCategory?.name === category.name ||
                  d.additionalCategories.some((c) => c.name === category.name)
                    ? d
                    : {
                        ...d,
                        additionalCategories: [
                          ...d.additionalCategories,
                          category,
                        ],
                      }
                )
              }
            />
          </div>

          <Field>
            <FieldLabel htmlFor={labelsId}>Labels</FieldLabel>
            <Textarea
              id={labelsId}
              value={draft.labels.join("\n")}
              disabled={disabled}
              rows={3}
              placeholder="One label per line"
              onChange={(event) =>
                setDraft((d) => ({
                  ...d,
                  labels: event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>Store code</FieldLabel>
            <Input
              value={draft.storeCode}
              disabled={disabled}
              onChange={(event) =>
                setDraft((d) => ({ ...d, storeCode: event.target.value }))
              }
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span
              id={openStatusLabelId}
              className="text-ui font-medium text-ink"
            >
              Open status
            </span>
            <Select
              value={draft.openStatus}
              onValueChange={(value: string | null) =>
                value && setDraft((d) => ({ ...d, openStatus: value }))
              }
              disabled={disabled}
            >
              <SelectTrigger
                className="w-full sm:w-64"
                aria-label="Open status"
                aria-describedby={openStatusLabelId}
                aria-invalid={issues.title ? true : undefined}
              >
                {/* Render function so the trigger reads the humanised label on
                first paint, before the popup's items have registered (§7). */}
                <SelectValue>
                  {(value: string | null) =>
                    value ? openStatusLabel(value) : ""
                  }
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
            {issues.title ? (
              <p role="alert" className="text-caption text-danger-ink">
                {issues.title}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
