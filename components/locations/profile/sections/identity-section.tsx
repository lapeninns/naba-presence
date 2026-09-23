"use client"

import type { Dispatch, SetStateAction } from "react"

import { CategorySearch } from "@/components/locations/business-information/category-search"
import {
  LabelRow,
  SectionCard,
} from "@/components/locations/profile/section-card"
import { Badge } from "@/components/ui/badge"
import { RemovableChip } from "@/components/ui/chip"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { StatusPill } from "@/components/ui/status-pill"
import { TagInput } from "@/components/ui/tag-input"
import { categoryLabel } from "@/lib/locations/console-labels"
import type { ProfileFormValues } from "@/lib/locations/forms/profile"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"

export const PROFILE_FIELD_IDS = {
  name: "profile-name",
  description: "profile-description",
  phone: "profile-phone",
  website: "profile-website",
  address: "profile-address",
  storeCode: "profile-store-code",
  labels: "profile-labels",
} as const

/** Google allows up to 9 additional categories and 10 labels. */
const MAX_ADDITIONAL = 9
const MAX_LABELS = 10

/**
 * Who this business is: the name customers read, plus the store code and
 * labels that only the business sees.
 *
 * The name is the NabaPresence copy — the one Google gets when this
 * publishes — so it is edited once here, not again under a second tab
 * holding Google's version of the same field. Labels stay: they are how an
 * agency groups a client's listings in Google, even though customers never
 * see them.
 */
export function IdentitySection({
  values,
  setValues,
  draft,
  setDraft,
  errors,
  disabled,
  googleReady,
  changed,
}: {
  values: ProfileFormValues
  setValues: Dispatch<SetStateAction<ProfileFormValues>>
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  errors: Partial<Record<keyof ProfileFormValues, string>>
  disabled: boolean
  /** False while Google's half of the listing has not arrived. */
  googleReady: boolean
  changed: { name: boolean; storeCode: boolean; labels: boolean }
}) {
  return (
    <SectionCard
      id="section-identity"
      title="Identity"
      description="The name customers see. Google may review name changes before they show."
      changed={changed.name || changed.storeCode || changed.labels}
    >
      <div className="grid grid-cols-1 gap-4 @[600px]/profile-body:grid-cols-2">
        <Field error={errors.name} className="@[600px]/profile-body:col-span-2">
          <LabelRow changed={changed.name}>
            <FieldLabel htmlFor={PROFILE_FIELD_IDS.name}>
              Business name
            </FieldLabel>
          </LabelRow>
          <Input
            id={PROFILE_FIELD_IDS.name}
            value={values.name}
            disabled={disabled}
            autoComplete="organization"
            onChange={(event) =>
              setValues((v) => ({ ...v, name: event.target.value }))
            }
          />
          <FieldDescription>
            Use the name on the sign. Don’t add places or offers — Google can
            suspend listings for it.
          </FieldDescription>
          <FieldError />
        </Field>

        {googleReady ? (
          <>
            <Field>
              <LabelRow changed={changed.storeCode}>
                <FieldLabel htmlFor={PROFILE_FIELD_IDS.storeCode}>
                  Store code
                </FieldLabel>
              </LabelRow>
              <Input
                id={PROFILE_FIELD_IDS.storeCode}
                value={draft.storeCode}
                disabled={disabled}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, storeCode: event.target.value }))
                }
              />
              <FieldDescription>
                Your own reference. Customers never see it.
              </FieldDescription>
            </Field>

            <Field className="@[600px]/profile-body:col-span-2">
              <LabelRow
                changed={changed.labels}
                extra={
                  <span className="font-mono text-caption text-ink-muted tabular-nums">
                    {draft.labels.length} of {MAX_LABELS}
                  </span>
                }
              >
                <FieldLabel htmlFor={PROFILE_FIELD_IDS.labels}>
                  Labels
                </FieldLabel>
              </LabelRow>
              <TagInput
                id={PROFILE_FIELD_IDS.labels}
                value={draft.labels}
                max={MAX_LABELS}
                disabled={disabled}
                placeholder="Add a label and press Enter"
                removeLabel={(tag) => `Remove label ${tag}`}
                validate={(tag) =>
                  tag.length > 255 ? "Keep a label under 255 characters." : null
                }
                onChange={(labels) => setDraft((d) => ({ ...d, labels }))}
              />
              <FieldDescription>
                Groups this listing in Google Business Profile. Customers never
                see labels.
              </FieldDescription>
            </Field>
          </>
        ) : null}
      </div>
    </SectionCard>
  )
}

/**
 * The primary category decides which searches the listing appears in; the
 * additional ones say what else it offers. Picking a primary category that
 * was listed as additional moves it, since Google refuses a category in both.
 */
export function CategoriesSection({
  locationId,
  draft,
  setDraft,
  disabled,
  changed,
}: {
  locationId: string
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  disabled: boolean
  changed: { primary: boolean; additional: boolean }
}) {
  const full = draft.additionalCategories.length >= MAX_ADDITIONAL
  return (
    <SectionCard
      id="section-categories"
      title="Categories"
      description="The primary category describes the business as a whole and decides which searches it appears in. Add up to 9 more for what else it offers."
      changed={changed.primary || changed.additional}
    >
      <div className="flex flex-col gap-2">
        <LabelRow changed={changed.primary}>
          <span className="text-ui font-semibold text-ink">
            Primary category
          </span>
        </LabelRow>
        <div className="flex flex-wrap items-center gap-2.5 rounded-(--np-radius-control) bg-surface-alt px-3 py-2.5">
          {draft.primaryCategory ? (
            <StatusPill tone="accent" plain>
              {categoryLabel(draft.primaryCategory)}
            </StatusPill>
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
            setDraft((d) => ({
              ...d,
              primaryCategory: category,
              additionalCategories: d.additionalCategories.filter(
                (c) => c.name !== category.name
              ),
            }))
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <LabelRow
          changed={changed.additional}
          extra={
            <span className="font-mono text-caption text-ink-muted tabular-nums">
              {draft.additionalCategories.length} of {MAX_ADDITIONAL}
            </span>
          }
        >
          <span className="text-ui font-semibold text-ink">
            Additional categories
          </span>
        </LabelRow>
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
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
          disabled={disabled || full}
          onSelect={(category) =>
            setDraft((d) =>
              d.primaryCategory?.name === category.name ||
              d.additionalCategories.some((c) => c.name === category.name) ||
              d.additionalCategories.length >= MAX_ADDITIONAL
                ? d
                : {
                    ...d,
                    additionalCategories: [...d.additionalCategories, category],
                  }
            )
          }
        />
        <p className="text-caption text-ink-muted">
          {full
            ? "Google allows 9 additional categories. Remove one to add another."
            : "A category can’t be both primary and additional."}
        </p>
      </div>
    </SectionCard>
  )
}
