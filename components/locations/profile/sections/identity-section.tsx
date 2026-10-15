"use client"

import {
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react"

import {
  CategoryPickerSheet,
  CategorySearch,
} from "@/components/locations/business-information/category-search"
import {
  LabelRow,
  SaveModelTag,
  SectionCard,
} from "@/components/locations/profile/section-card"
import { Badge } from "@/components/ui/badge"
import { RemovableChip } from "@/components/ui/chip"
import { Field, FieldDescription, FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SettingsRow } from "@/components/ui/settings-row"
import { StatusPill } from "@/components/ui/status-pill"
import { TagInput } from "@/components/ui/tag-input"
import { useBreakpoint } from "@/lib/hooks/use-media-query"
import { categoryLabel } from "@/lib/locations/console-labels"
import type { ProfileFormValues } from "@/lib/locations/forms/profile"
import type {
  BusinessInformationDraft,
  CategoryRef,
} from "@/lib/locations/google-values"

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
      {/* Settings rows that edit in place: the label (and where the field
          is saved) over the field, its hint and its error under it. */}
      <SettingsRow
        label="Business name"
        controlId={PROFILE_FIELD_IDS.name}
        changed={changed.name ? "Changed" : undefined}
        description={<SaveModelTag model="here" variant="caption" />}
        control={
          <Field measure="short" error={errors.name}>
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
        }
      />

      {googleReady ? (
        <>
          <SettingsRow
            label="Store code"
            controlId={PROFILE_FIELD_IDS.storeCode}
            changed={changed.storeCode ? "Changed" : undefined}
            description={<SaveModelTag model="google" variant="caption" />}
            control={
              <Field measure="short">
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
            }
          />

          <SettingsRow
            label="Labels"
            controlId={PROFILE_FIELD_IDS.labels}
            changed={changed.labels ? "Changed" : undefined}
            description={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <SaveModelTag model="google" variant="caption" />
                <span className="tabular-nums">
                  {draft.labels.length} of {MAX_LABELS}
                </span>
              </span>
            }
            control={
              <Field>
                <TagInput
                  id={PROFILE_FIELD_IDS.labels}
                  value={draft.labels}
                  max={MAX_LABELS}
                  disabled={disabled}
                  placeholder="Add a label and press Enter"
                  removeLabel={(tag) => `Remove label ${tag}`}
                  validate={(tag) =>
                    tag.length > 255
                      ? "Keep a label under 255 characters."
                      : null
                  }
                  onChange={(labels) => setDraft((d) => ({ ...d, labels }))}
                />
                <FieldDescription>
                  Groups this listing in Google Business Profile. Customers
                  never see labels.
                </FieldDescription>
              </Field>
            }
          />
        </>
      ) : null}
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
  // The desk picks from the search field's list; a phone opens Google's
  // category search in a full sheet from a settings row (behaviour, so JS).
  const desk = useBreakpoint("desk")
  const [picking, setPicking] = useState<"primary" | "additional" | null>(null)
  // The phone's opener rows (a settings row has no ref of its own), for the
  // sheets to hand focus back to: a tap in Safari never focuses a button.
  const primaryRowRef = useRef<HTMLDivElement>(null)
  const additionalRowRef = useRef<HTMLDivElement>(null)
  // A stable target for when "Add another category" is disabled on close
  // (the 9th category filled the list inside the sheet).
  const additionalLabelRef = useRef<HTMLSpanElement>(null)
  const setPrimary = (category: CategoryRef) =>
    setDraft((d) => ({
      ...d,
      primaryCategory: category,
      additionalCategories: d.additionalCategories.filter(
        (c) => c.name !== category.name
      ),
    }))
  const addAdditional = (category: CategoryRef) =>
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
  const removeAdditional = (category: CategoryRef) =>
    setDraft((d) => ({
      ...d,
      additionalCategories: d.additionalCategories.filter(
        (c) => c.name !== category.name
      ),
    }))
  const fullNote =
    "Google allows 9 additional categories. Remove one to add another."
  const bothNote = "A category can’t be both primary and additional."
  return (
    <SectionCard
      id="section-categories"
      model="google"
      title="Categories"
      description="The primary category describes the business as a whole and decides which searches it appears in. Add up to 9 more for what else it offers."
      changed={changed.primary || changed.additional}
    >
      {desk ? (
        <div className="flex flex-col gap-2">
          {/* A settings row: the label, then the current value on the right
              (under it on a narrow phone), with the search to change it below. */}
          <div className="flex min-h-(--np-row-h) flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <LabelRow changed={changed.primary}>
              <span className="text-ui font-medium text-ink">
                Primary category
              </span>
            </LabelRow>
            {draft.primaryCategory ? (
              <StatusPill tone="accent" plain>
                {categoryLabel(draft.primaryCategory)}
              </StatusPill>
            ) : (
              <span className="text-ui text-ink-muted">
                No primary category set.
              </span>
            )}
          </div>
          <CategorySearch
            locationId={locationId}
            label="Change primary category"
            disabled={disabled}
            onSelect={setPrimary}
          />
        </div>
      ) : (
        <>
          <div ref={primaryRowRef} className="min-w-0">
            <SettingsRow
              label="Primary category"
              changed={changed.primary ? "Changed" : undefined}
              value={
                draft.primaryCategory
                  ? categoryLabel(draft.primaryCategory)
                  : undefined
              }
              description={
                draft.primaryCategory ? undefined : "No primary category set."
              }
              disabled={disabled}
              onClick={() => setPicking("primary")}
            />
          </div>
          <CategoryPickerSheet
            locationId={locationId}
            title="Change primary category"
            type="single"
            open={picking === "primary"}
            onOpenChange={(open) => setPicking(open ? "primary" : null)}
            finalFocus={() => enabledButtonIn(primaryRowRef) ?? true}
            isSelected={(category) =>
              category.name === draft.primaryCategory?.name
            }
            onSelect={setPrimary}
          />
        </>
      )}

      <div className="flex flex-col gap-2 border-t border-line-subtle pt-4">
        <LabelRow
          changed={changed.additional}
          extra={
            <span className="text-caption text-ink-muted tabular-nums">
              {draft.additionalCategories.length} of {MAX_ADDITIONAL}
            </span>
          }
        >
          <span
            ref={additionalLabelRef}
            tabIndex={-1}
            className="rounded-(--np-radius-tag) text-ui font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-(--np-focus-ring) forced-colors:focus-visible:outline-2"
          >
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
                  onRemove={() => removeAdditional(category)}
                >
                  {categoryLabel(category)}
                </RemovableChip>
              )
            )
          )}
        </div>
        {desk ? (
          <CategorySearch
            locationId={locationId}
            label="Add another category"
            disabled={disabled || full}
            onSelect={addAdditional}
          />
        ) : (
          <>
            <div ref={additionalRowRef} className="min-w-0">
              <SettingsRow
                label="Add another category"
                disabled={disabled || full}
                onClick={() => setPicking("additional")}
              />
            </div>
            <CategoryPickerSheet
              locationId={locationId}
              title="Add another category"
              type="multiple"
              open={picking === "additional"}
              onOpenChange={(open) => setPicking(open ? "additional" : null)}
              finalFocus={() =>
                enabledButtonIn(additionalRowRef) ??
                additionalLabelRef.current ??
                true
              }
              isSelected={(category) =>
                draft.additionalCategories.some((c) => c.name === category.name)
              }
              unavailable={(category) =>
                category.name === draft.primaryCategory?.name
                  ? bothNote
                  : full
                    ? fullNote
                    : null
              }
              onSelect={addAdditional}
              onDeselect={removeAdditional}
            />
          </>
        )}
        <p className="text-caption text-ink-muted">
          {full ? fullNote : bothNote}
        </p>
      </div>
    </SectionCard>
  )
}

/** The enabled button inside a wrapper, or null when it is gone or disabled. */
function enabledButtonIn(ref: RefObject<HTMLElement | null>) {
  const button = ref.current?.querySelector<HTMLButtonElement>("button")
  return button && !button.disabled ? button : null
}
