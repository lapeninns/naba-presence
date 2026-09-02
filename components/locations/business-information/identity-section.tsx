"use client"

import { useId, type Dispatch, type SetStateAction } from "react"

import { CategorySearch } from "@/components/locations/business-information/category-search"
import { Badge } from "@/components/ui/badge"
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

/** Name, description, categories, labels, store code and open status. */
export function IdentitySection({
  locationId,
  draft,
  setDraft,
  issues,
  disabled,
}: {
  locationId: string
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  issues: PayloadFieldErrors
  disabled: boolean
}) {
  const labelsId = useId()

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <h2 className="text-title font-semibold">Identity</h2>
      <Field error={issues.title}>
        <FieldLabel>Business name</FieldLabel>
        <Input
          value={draft.title}
          disabled={disabled}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
        <FieldError />
      </Field>
      <Field error={issues.description}>
        <FieldLabel>Description</FieldLabel>
        <Textarea
          value={draft.description}
          disabled={disabled}
          rows={4}
          onChange={(e) =>
            setDraft((d) => ({ ...d, description: e.target.value }))
          }
        />
        <FieldError />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-ui font-medium">Primary category</span>
        <div className="flex flex-wrap items-center gap-2">
          {draft.primaryCategory ? (
            <Badge variant="secondary">
              {categoryLabel(draft.primaryCategory)}
            </Badge>
          ) : (
            <span className="text-caption text-muted-foreground">
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
        <span className="text-ui font-medium">Additional categories</span>
        <div className="flex flex-wrap items-center gap-2">
          {draft.additionalCategories.length === 0 ? (
            <span className="text-caption text-muted-foreground">
              None set.
            </span>
          ) : (
            draft.additionalCategories.map((category) => (
              <Badge key={category.name} variant="outline">
                {categoryLabel(category)}
                <button
                  type="button"
                  aria-label={`Remove ${categoryLabel(category)}`}
                  disabled={disabled}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      additionalCategories: d.additionalCategories.filter(
                        (c) => c.name !== category.name
                      ),
                    }))
                  }
                >
                  ×
                </button>
              </Badge>
            ))
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
                    additionalCategories: [...d.additionalCategories, category],
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
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              labels: e.target.value
                .split("\n")
                .map((l) => l.trim())
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
          onChange={(e) =>
            setDraft((d) => ({ ...d, storeCode: e.target.value }))
          }
        />
      </Field>
      <div className="flex flex-col gap-1">
        <span className="text-ui font-medium">Open status</span>
        <Select
          value={draft.openStatus}
          onValueChange={(value: string | null) =>
            value && setDraft((d) => ({ ...d, openStatus: value }))
          }
          disabled={disabled}
        >
          <SelectTrigger aria-label="Open status">
            {/* Render function so the trigger reads the humanised label on
                first paint, before the popup's items have registered (§7). */}
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
      </div>
    </section>
  )
}
