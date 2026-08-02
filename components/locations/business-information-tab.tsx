"use client"

import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useId, useMemo, useRef, useState } from "react"

import { GoogleDiff } from "@/components/locations/google-diff"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { TypedAttributeControl } from "@/components/locations/typed-attribute-control"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem } from "@/components/ui/combobox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import {
  publishBusinessAttributes,
  publishBusinessInformation,
  type AttributeMetadata,
  type BusinessInformationState,
  type BusinessMask,
  type GoogleAttribute,
} from "@/lib/api/location-business-information"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { describeActionError } from "@/lib/locations/action-errors"
import { categoryLabel, openStatusLabel } from "@/lib/locations/console-labels"
import { editDisabledReason, publishDisabledReason, type LocationCapabilities } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useBusinessInformation, useBusinessInformationMetadata } from "@/lib/queries/use-location-business-information"

// --- raw Google leaf -> typed accessor helpers -----------------------------
// `location`/`attributes` arrive as passthrough records (they vary by
// category and by what the merchant has set on Google) — these read known
// leaves defensively and never assume a shape that isn't there.
type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : undefined
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}
function isPresent(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "object") return Object.keys(value as object).length > 0
  return true
}

type CategoryRef = { name: string; displayName?: string | null }

function toCategoryRef(value: unknown): CategoryRef | null {
  const record = asRecord(value)
  const name = asString(record?.name)
  if (!name) return null
  return { name, displayName: typeof record?.displayName === "string" ? record.displayName : null }
}

function extractCategories(result: unknown): CategoryRef[] {
  const record = asRecord(result)
  const list = Array.isArray(record?.categories) ? record.categories : []
  return list.map(toCategoryRef).filter((entry): entry is CategoryRef => entry !== null)
}

// The complex/unsupported Google leaves this editor never grows a control
// for (spec §12) — shown read-only, never as raw JSON (spec §8).
const UNSUPPORTED_LEAVES: Array<{ key: string; label: string }> = [
  { key: "serviceItems", label: "Service items" },
  { key: "serviceArea", label: "Service area" },
  { key: "relationshipData", label: "Related businesses" },
  { key: "moreHours", label: "Extra opening hours" },
]

// --- draft shape -------------------------------------------------------
type Draft = {
  title: string
  description: string
  primaryPhone: string
  websiteUri: string
  openStatus: string
  storeCode: string
  labels: string[]
  primaryCategory: CategoryRef | null
  additionalCategories: CategoryRef[]
  addressLines: string[]
  locality: string
  postalCode: string
  regionCode: string
}

const OPEN_STATUS_OPTIONS = ["OPEN", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"] as const

const LOCATION_FIELD_LABELS: Record<BusinessMask, string> = {
  title: "Business name",
  profile: "Description",
  phoneNumbers: "Phone",
  websiteUri: "Website",
  storefrontAddress: "Address",
  categories: "Categories",
  serviceArea: "Service area",
  serviceItems: "Service items",
  labels: "Labels",
  storeCode: "Store code",
  openInfo: "Open status",
  relationshipData: "Relationship data",
}

// --- touched -> mask + strict payload (silent; users never see masks/JSON) ---
// Build the update_location payload from ONLY the fields the user changed. Each
// entry maps a form leaf to its Google shape; the mask is exactly the keys present.
function buildLocationUpdate(initial: Draft, draft: Draft): { updateMask: BusinessMask[]; payload: Record<string, unknown> } {
  const payload: Record<string, unknown> = {}
  const mask: BusinessMask[] = []
  if (draft.title !== initial.title) { payload.title = draft.title; mask.push("title") }
  if (draft.description !== initial.description) { payload.profile = { description: draft.description }; mask.push("profile") }
  if (draft.primaryPhone !== initial.primaryPhone) { payload.phoneNumbers = { primaryPhone: draft.primaryPhone }; mask.push("phoneNumbers") }
  if (draft.websiteUri !== initial.websiteUri) { payload.websiteUri = draft.websiteUri; mask.push("websiteUri") }
  if (draft.openStatus !== initial.openStatus) { payload.openInfo = { status: draft.openStatus }; mask.push("openInfo") }
  if (draft.storeCode !== initial.storeCode) { payload.storeCode = draft.storeCode; mask.push("storeCode") }
  if (JSON.stringify(draft.labels) !== JSON.stringify(initial.labels)) { payload.labels = draft.labels; mask.push("labels") }
  if (draft.primaryCategory?.name !== initial.primaryCategory?.name || JSON.stringify(draft.additionalCategories) !== JSON.stringify(initial.additionalCategories)) {
    payload.categories = { primaryCategory: { name: draft.primaryCategory!.name }, additionalCategories: draft.additionalCategories.map((c) => ({ name: c.name })) }
    mask.push("categories")
  }
  if (draft.addressLines.join("\n") !== initial.addressLines.join("\n") || draft.locality !== initial.locality || draft.postalCode !== initial.postalCode) {
    payload.storefrontAddress = { regionCode: draft.regionCode, addressLines: draft.addressLines, locality: draft.locality, postalCode: draft.postalCode }
    mask.push("storefrontAddress")
  }
  return { updateMask: mask, payload }
}

function buildAttributesUpdate(
  metadata: AttributeMetadata[],
  initial: Record<string, GoogleAttribute>,
  draft: Record<string, GoogleAttribute>
): { attributeMask: string[]; attributes: GoogleAttribute[] } {
  const attributeMask: string[] = []
  const attributes: GoogleAttribute[] = []
  for (const meta of metadata) {
    const name = meta.parent
    if (JSON.stringify(draft[name]) === JSON.stringify(initial[name])) continue
    attributeMask.push(name)
    const current = draft[name]
    if (current) attributes.push(current)
  }
  return { attributeMask, attributes }
}

type PayloadFieldKey = "title" | "description" | "primaryPhone" | "websiteUri" | "addressLines"

const PAYLOAD_KEY_TO_FIELD: Record<string, PayloadFieldKey> = {
  title: "title",
  profile: "description",
  phoneNumbers: "primaryPhone",
  websiteUri: "websiteUri",
  storefrontAddress: "addressLines",
}

// Optional strict validation before send (spec §6): re-uses the same
// businessInformationPayloadSchema the PATCH route enforces, so a bad value
// (e.g. an empty title) surfaces as a field error here rather than only as a
// generic toast after the request round-trips. Never shown as raw zod/JSON —
// only the schema's own plain-English `message` reaches the field.
function fieldErrorsFromPayload(payload: Record<string, unknown>): Partial<Record<PayloadFieldKey, string>> {
  const parsed = businessInformationPayloadSchema.safeParse(payload)
  if (parsed.success) return {}
  const errors: Partial<Record<PayloadFieldKey, string>> = {}
  for (const issue of parsed.error.issues) {
    const field = PAYLOAD_KEY_TO_FIELD[String(issue.path[0] ?? "")]
    if (field && !(field in errors)) errors[field] = issue.message
  }
  return errors
}

function formatAddress(draft: Pick<Draft, "addressLines" | "locality" | "postalCode">): string | null {
  const parts = [...draft.addressLines, draft.locality, draft.postalCode].map((p) => p.trim()).filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : null
}

function categoriesSummary(draft: Pick<Draft, "primaryCategory" | "additionalCategories">): string | null {
  const names = [draft.primaryCategory, ...draft.additionalCategories].filter((c): c is CategoryRef => c !== null).map(categoryLabel)
  return names.length > 0 ? names.join(", ") : null
}

function locationDiffRows(mask: BusinessMask[], initial: Draft, draft: Draft) {
  return mask.map((key) => {
    const label = LOCATION_FIELD_LABELS[key]
    switch (key) {
      case "title": return { key, label, currentValue: initial.title || null, nextValue: draft.title || null }
      case "profile": return { key, label, currentValue: initial.description || null, nextValue: draft.description || null }
      case "phoneNumbers": return { key, label, currentValue: initial.primaryPhone || null, nextValue: draft.primaryPhone || null }
      case "websiteUri": return { key, label, currentValue: initial.websiteUri || null, nextValue: draft.websiteUri || null }
      case "openInfo": return { key, label, currentValue: openStatusLabel(initial.openStatus), nextValue: openStatusLabel(draft.openStatus) }
      case "storeCode": return { key, label, currentValue: initial.storeCode || null, nextValue: draft.storeCode || null }
      case "labels": return { key, label, currentValue: initial.labels.join(", ") || null, nextValue: draft.labels.join(", ") || null }
      case "categories": return { key, label, currentValue: categoriesSummary(initial), nextValue: categoriesSummary(draft) }
      case "storefrontAddress": return { key, label, currentValue: formatAddress(initial), nextValue: formatAddress(draft) }
      default: return { key, label, currentValue: null, nextValue: null }
    }
  })
}

// Mirrors typed-attribute-control.tsx's own (unexported) enum-option reader,
// so the diff preview can humanise a raw Google enum value the same way the
// control itself does — never a raw enum string (spec §7).
function enumOptionsFor(metadata: AttributeMetadata): Array<{ value: string; label: string }> {
  const meta = metadata as unknown as { valueMetadata?: Array<{ value?: string; displayName?: string }> }
  return (meta.valueMetadata ?? [])
    .filter((entry): entry is { value: string; displayName?: string } => typeof entry.value === "string")
    .map((entry) => ({ value: entry.value, label: entry.displayName ?? entry.value }))
}

function describeAttributeValue(metadata: AttributeMetadata | undefined, attribute: GoogleAttribute | undefined): string | null {
  if (!metadata) return null
  switch (metadata.valueType) {
    case "BOOL":
      return attribute?.values?.[0] === true ? "Yes" : "No"
    case "ENUM": {
      const value = attribute?.repeatedEnumValue?.setValues?.[0]
      if (!value) return "Not set"
      return enumOptionsFor(metadata).find((option) => option.value === value)?.label ?? value
    }
    case "URL":
      return attribute?.uriValues?.[0]?.uri || "Not set"
    default:
      return null
  }
}

function groupByLabel<T>(items: T[], keyFn: (item: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return Array.from(map.entries())
}

export function BusinessInformationTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const infoQuery = useBusinessInformation(locationId)
  const capsQuery = useLocationCapabilities(locationId)

  if (infoQuery.isPending || capsQuery.isPending) return <TabLoading />
  if (infoQuery.isError) return <TabError error={infoQuery.error} onRetry={() => infoQuery.refetch()} />

  return (
    <BusinessInformationTabLoaded
      locationId={locationId}
      state={infoQuery.data}
      caps={capsQuery.data}
      invalidate={() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.locationBusinessInformation(locationId) })
      }}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function BusinessInformationTabLoaded({
  locationId,
  state,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  state: BusinessInformationState
  caps: LocationCapabilities | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const location = state.location as RawRecord
  const initial: Draft = useMemo(() => {
    const profile = asRecord(location.profile)
    const phoneNumbers = asRecord(location.phoneNumbers)
    const openInfo = asRecord(location.openInfo)
    const storefrontAddress = asRecord(location.storefrontAddress)
    const categories = asRecord(location.categories)
    const additionalCategoriesRaw = Array.isArray(categories?.additionalCategories) ? categories.additionalCategories : []
    return {
      title: asString(location.title),
      description: asString(profile?.description),
      primaryPhone: asString(phoneNumbers?.primaryPhone),
      websiteUri: asString(location.websiteUri),
      openStatus: asString(openInfo?.status) || "OPEN",
      storeCode: asString(location.storeCode),
      labels: asStringArray(location.labels),
      primaryCategory: toCategoryRef(categories?.primaryCategory),
      additionalCategories: additionalCategoriesRaw.map(toCategoryRef).filter((c): c is CategoryRef => c !== null),
      addressLines: asStringArray(storefrontAddress?.addressLines),
      locality: asString(storefrontAddress?.locality),
      postalCode: asString(storefrontAddress?.postalCode),
      regionCode: asString(storefrontAddress?.regionCode) || "GB",
    }
  }, [location])

  const [draft, setDraft] = useState<Draft>(initial)
  // Deviation from the M5 ProfileTab reference (a bare `useEffect(() =>
  // setValues(initial), [...])`): react-hooks/set-state-in-effect flags an
  // effect whose body is nothing but a synchronous setState. Ref-guard
  // instead — only reset local edits when the Google hash actually
  // advances (a refetch after a successful publish), not on every
  // incidental re-render of `initial`.
  const locationHashRef = useRef(state.locationHash)
  useEffect(() => {
    if (locationHashRef.current === state.locationHash) return
    locationHashRef.current = state.locationHash
    setDraft(initial)
  }, [initial, state.locationHash])

  const initialAttributes = useMemo(() => {
    const raw = asRecord(state.attributes)
    const list = Array.isArray(raw?.attributes) ? raw.attributes : []
    const map: Record<string, GoogleAttribute> = {}
    for (const meta of state.attributeMetadata) {
      const found = list.find((entry) => asRecord(entry)?.name === meta.parent)
      const record = asRecord(found)
      if (!record) continue
      map[meta.parent] = {
        name: meta.parent,
        values: Array.isArray(record.values) ? record.values : undefined,
        uriValues: Array.isArray(record.uriValues)
          ? record.uriValues
              .map((v) => asRecord(v))
              .filter((v): v is RawRecord => v !== undefined && typeof v.uri === "string")
              .map((v) => ({ uri: v.uri as string, uriType: typeof v.uriType === "string" ? v.uriType : undefined }))
          : undefined,
        repeatedEnumValue: asRecord(record.repeatedEnumValue)
          ? {
              setValues: asStringArray(asRecord(record.repeatedEnumValue)?.setValues),
              unsetValues: asStringArray(asRecord(record.repeatedEnumValue)?.unsetValues),
            }
          : undefined,
      }
    }
    return map
  }, [state.attributes, state.attributeMetadata])

  const [attributesDraft, setAttributesDraft] = useState<Record<string, GoogleAttribute>>(initialAttributes)
  const attributesHashRef = useRef(state.attributesHash)
  useEffect(() => {
    if (attributesHashRef.current === state.attributesHash) return
    attributesHashRef.current = state.attributesHash
    setAttributesDraft(initialAttributes)
  }, [initialAttributes, state.attributesHash])

  const editReason = editDisabledReason(caps)
  const publishReason = editReason ?? publishDisabledReason(caps, state.writesEnabled)
  const disabled = Boolean(editReason)

  const locationUpdate = useMemo(() => buildLocationUpdate(initial, draft), [initial, draft])
  const locationIssues = useMemo(() => fieldErrorsFromPayload(locationUpdate.payload), [locationUpdate.payload])
  const attributeMetaByName = useMemo(() => new Map(state.attributeMetadata.map((m) => [m.parent, m])), [state.attributeMetadata])
  const attributesUpdate = useMemo(
    () => buildAttributesUpdate(state.attributeMetadata, initialAttributes, attributesDraft),
    [state.attributeMetadata, initialAttributes, attributesDraft]
  )

  const [locationConfirmOpen, setLocationConfirmOpen] = useState(false)
  const [attributesConfirmOpen, setAttributesConfirmOpen] = useState(false)

  const publishLocation = useMutation({
    mutationFn: () => {
      const payload = businessInformationPayloadSchema.parse(locationUpdate.payload)
      return publishBusinessInformation(locationId, {
        updateMask: locationUpdate.updateMask,
        payload,
        expectedGoogleHash: state.locationHash,
      })
    },
    onSuccess: () => {
      setLocationConfirmOpen(false)
      invalidate()
      toast("Published to Google", "success")
    },
    onError: (error) => {
      setLocationConfirmOpen(false)
      if (error instanceof ApiClientError && error.code === "business_information_stale") invalidate()
      toast(describeActionError(error), "error")
    },
  })

  const publishAttributes = useMutation({
    mutationFn: () =>
      publishBusinessAttributes(locationId, {
        attributeMask: attributesUpdate.attributeMask,
        attributes: attributesUpdate.attributes,
        expectedGoogleHash: state.attributesHash,
      }),
    onSuccess: () => {
      setAttributesConfirmOpen(false)
      invalidate()
      toast("Attribute changes published to Google", "success")
    },
    onError: (error) => {
      setAttributesConfirmOpen(false)
      if (error instanceof ApiClientError && error.code === "attributes_stale") invalidate()
      toast(describeActionError(error), "error")
    },
  })

  const locationDiff = useMemo(() => locationDiffRows(locationUpdate.updateMask, initial, draft), [locationUpdate.updateMask, initial, draft])
  const attributesDiff = useMemo(
    () =>
      attributesUpdate.attributeMask.map((name) => {
        const meta = attributeMetaByName.get(name)
        return {
          key: name,
          label: meta?.displayName ?? name,
          currentValue: describeAttributeValue(meta, initialAttributes[name]),
          nextValue: describeAttributeValue(meta, attributesDraft[name]),
        }
      }),
    [attributesUpdate.attributeMask, attributeMetaByName, initialAttributes, attributesDraft]
  )

  const groupedAttributes = useMemo(
    () => groupByLabel(state.attributeMetadata, (m) => m.groupDisplayName ?? "Other"),
    [state.attributeMetadata]
  )

  const presentUnsupported = UNSUPPORTED_LEAVES.filter(({ key }) => isPresent(location[key]))

  const labelsId = useId()
  const addressId = useId()

  return (
    <div className="flex flex-col gap-8">
      <p className="text-caption text-muted-foreground">
        These details also sync via the{" "}
        <Link href={`/locations/${locationId}`} className="underline">
          Profile tab
        </Link>
        , which keeps them in step with NabaPresence.
      </p>

      <GateNote reason={editReason} />

      <section className="flex max-w-xl flex-col gap-4">
        <h2 className="text-title font-semibold">Identity</h2>
        <Field error={locationIssues.title}>
          <FieldLabel>Business name</FieldLabel>
          <Input value={draft.title} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          <FieldError />
        </Field>
        <Field error={locationIssues.description}>
          <FieldLabel>Description</FieldLabel>
          <Textarea value={draft.description} disabled={disabled} rows={4} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          <FieldError />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-ui font-medium">Primary category</span>
          <div className="flex flex-wrap items-center gap-2">
            {draft.primaryCategory ? (
              <Badge variant="secondary">{categoryLabel(draft.primaryCategory)}</Badge>
            ) : (
              <span className="text-caption text-muted-foreground">No primary category set.</span>
            )}
          </div>
          <CategorySearch
            locationId={locationId}
            label="Change primary category"
            disabled={disabled}
            onSelect={(category) => setDraft((d) => ({ ...d, primaryCategory: category }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-ui font-medium">Additional categories</span>
          <div className="flex flex-wrap items-center gap-2">
            {draft.additionalCategories.length === 0 ? (
              <span className="text-caption text-muted-foreground">None set.</span>
            ) : (
              draft.additionalCategories.map((category) => (
                <Badge key={category.name} variant="outline">
                  {categoryLabel(category)}
                  <button
                    type="button"
                    aria-label={`Remove ${categoryLabel(category)}`}
                    disabled={disabled}
                    onClick={() => setDraft((d) => ({ ...d, additionalCategories: d.additionalCategories.filter((c) => c.name !== category.name) }))}
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
                d.primaryCategory?.name === category.name || d.additionalCategories.some((c) => c.name === category.name)
                  ? d
                  : { ...d, additionalCategories: [...d.additionalCategories, category] }
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
            onChange={(e) => setDraft((d) => ({ ...d, labels: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) }))}
          />
        </Field>
        <Field>
          <FieldLabel>Store code</FieldLabel>
          <Input value={draft.storeCode} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, storeCode: e.target.value }))} />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-ui font-medium">Open status</span>
          <Select value={draft.openStatus} onValueChange={(value: string | null) => value && setDraft((d) => ({ ...d, openStatus: value }))} disabled={disabled}>
            <SelectTrigger aria-label="Open status">
              <SelectValue />
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

      <section className="flex max-w-xl flex-col gap-4">
        <h2 className="text-title font-semibold">Contact</h2>
        <Field error={locationIssues.primaryPhone}>
          <FieldLabel>Phone</FieldLabel>
          <Input value={draft.primaryPhone} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, primaryPhone: e.target.value }))} />
          <FieldError />
        </Field>
        <Field error={locationIssues.websiteUri}>
          <FieldLabel>Website</FieldLabel>
          <Input value={draft.websiteUri} disabled={disabled} inputMode="url" onChange={(e) => setDraft((d) => ({ ...d, websiteUri: e.target.value }))} />
          <FieldError />
        </Field>
        <Field error={locationIssues.addressLines}>
          <FieldLabel htmlFor={addressId}>Address lines</FieldLabel>
          <Textarea
            id={addressId}
            value={draft.addressLines.join("\n")}
            disabled={disabled}
            rows={3}
            placeholder="One line per address line"
            onChange={(e) => setDraft((d) => ({ ...d, addressLines: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) }))}
          />
          <FieldError />
        </Field>
        <Field>
          <FieldLabel>Town or city</FieldLabel>
          <Input value={draft.locality} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, locality: e.target.value }))} />
        </Field>
        <Field>
          <FieldLabel>Postcode</FieldLabel>
          <Input value={draft.postalCode} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, postalCode: e.target.value }))} />
        </Field>
      </section>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setLocationConfirmOpen(true)}
            disabled={
              Boolean(publishReason) ||
              locationUpdate.updateMask.length === 0 ||
              Object.keys(locationIssues).length > 0 ||
              publishLocation.isPending
            }
          >
            Publish to Google
          </Button>
        </div>
        <GateNote reason={editReason ? null : publishReason} />
      </div>

      <section className="flex max-w-xl flex-col gap-4">
        <h2 className="text-title font-semibold">Attributes</h2>
        {groupedAttributes.map(([group, items]) => (
          <div key={group} className="flex flex-col gap-3">
            <h3 className="text-ui font-semibold text-muted-foreground">{group}</h3>
            <div className="flex flex-col gap-3">
              {items.map((meta) => (
                <TypedAttributeControl
                  key={meta.parent}
                  metadata={meta}
                  attribute={attributesDraft[meta.parent]}
                  disabled={disabled}
                  onChange={(next) => setAttributesDraft((prev) => ({ ...prev, [next.name]: next }))}
                />
              ))}
            </div>
          </div>
        ))}
        {attributesUpdate.attributeMask.length > 0 ? (
          <div>
            <Button
              variant="outline"
              onClick={() => setAttributesConfirmOpen(true)}
              disabled={Boolean(publishReason) || publishAttributes.isPending}
            >
              Publish attribute changes to Google
            </Button>
          </div>
        ) : null}
      </section>

      {presentUnsupported.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold">Other Google details</h2>
          <p className="text-caption text-muted-foreground">Google holds additional information on this listing that can&apos;t be edited here yet.</p>
          <div className="flex flex-col gap-2">
            {presentUnsupported.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-0.5 text-ui">
                <span className="font-medium">{label}</span>
                <span className="text-caption text-muted-foreground">Not editable here yet.</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <AlertDialog open={locationConfirmOpen} onOpenChange={setLocationConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Publish these details to Google?</AlertDialogTitle>
          <AlertDialogDescription>Review the changes before they replace what is on your Google Business Profile.</AlertDialogDescription>
          <GoogleDiff rows={locationDiff} />
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={() => publishLocation.mutate()} disabled={publishLocation.isPending}>
              {publishLocation.isPending ? "Working…" : "Publish"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={attributesConfirmOpen} onOpenChange={setAttributesConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Publish these attributes to Google?</AlertDialogTitle>
          <AlertDialogDescription>Review the changes before they replace what is on your Google Business Profile.</AlertDialogDescription>
          <GoogleDiff rows={attributesDiff} />
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={() => publishAttributes.mutate()} disabled={publishAttributes.isPending}>
              {publishAttributes.isPending ? "Working…" : "Publish"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CategorySearch({
  locationId,
  label,
  disabled,
  onSelect,
}: {
  locationId: string
  label: string
  disabled: boolean
  onSelect: (category: CategoryRef) => void
}) {
  const [query, setQuery] = useState("")
  const inputId = useId()
  const metadataQuery = useBusinessInformationMetadata(locationId, "categories", query)
  const categories = extractCategories(metadataQuery.data?.result)

  return (
    <div className="flex max-w-xs flex-col gap-1">
      <label htmlFor={inputId} className="text-caption text-muted-foreground">
        {label}
      </label>
      <Combobox
        items={categories}
        value={null}
        filter={null}
        disabled={disabled}
        inputValue={query}
        onInputValueChange={(value) => setQuery(value)}
        onValueChange={(category: CategoryRef | null) => {
          if (!category) return
          onSelect(category)
          setQuery("")
        }}
        itemToStringLabel={(category: CategoryRef) => categoryLabel(category)}
      >
        <ComboboxInput id={inputId} placeholder="Search Google categories…" />
        <ComboboxContent>
          {metadataQuery.isFetching ? (
            <div className="px-3 py-2 text-ui text-muted-foreground">Searching…</div>
          ) : (
            categories.map((category) => (
              <ComboboxItem key={category.name} value={category}>
                {categoryLabel(category)}
              </ComboboxItem>
            ))
          )}
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
