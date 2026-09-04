"use client"

import { useId, useMemo } from "react"

import { SectionPanel } from "@/components/locations/section-panel"
import { TabError } from "@/components/locations/tab-states"
import { GateNote } from "@/components/locations/publish-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToastManager } from "@/components/ui/toast"
import {
  publishIndustry,
  type IndustryState,
} from "@/lib/api/location-industry"
import type { LocationCapabilities } from "@/lib/locations/gating"
import { callsStateLabel } from "@/lib/locations/console-labels"
import {
  inputToTimeOfDay,
  lodgingUpdatedPaths,
  timeOfDayToInput,
  touchedMask,
} from "@/lib/locations/forms/industry"
import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"
import { queryKeys } from "@/lib/queries/keys"
import { useIndustry } from "@/lib/queries/use-location-industry"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { tabGateReasons } from "@/lib/locations/gating"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

// --- raw Google leaf -> typed accessor helpers -----------------------------
// `lodging`/healthcare sub-resources arrive as passthrough records (D8) —
// these read known leaves defensively without ever assuming a shape.
type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {}
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/**
 * Lodging, business calls and healthcare: the fields that only exist for some
 * kinds of business.
 *
 * They used to be a whole tab called "Industry", named after the Google APIs
 * that serve them rather than after anything a hotelier would look for. Now
 * they are sections of the business profile, and they appear only for a
 * listing Google actually holds them for.
 *
 * The GET is owner/admin-only server-side, so the capability query gates the
 * mount: a member never fires the request that would 403.
 */
export function IndustrySections({
  locationId,
  enabled = true,
}: {
  locationId: string
  /** False until the rest of the listing has loaded; see useIndustry. */
  enabled?: boolean
}) {
  const caps = useLocationCapabilities(locationId)
  if (!caps.data?.canEditCanonical) return null
  return (
    <IndustryResource
      locationId={locationId}
      caps={caps.data}
      enabled={enabled}
    />
  )
}

function IndustryResource({
  locationId,
  caps,
  enabled,
}: {
  locationId: string
  caps: LocationCapabilities
  enabled: boolean
}) {
  const query = useIndustry(locationId, { enabled })
  if (!enabled || query.isPending) return null
  if (query.isError)
    return <TabError error={query.error} onRetry={() => void query.refetch()} />

  const { disabled, editReason, publishReason } = tabGateReasons(
    caps,
    "industry",
    query.data.writesEnabled ?? true
  )
  // Every one of these sections is empty for most listings; rendering the
  // headings anyway would tell a cafe owner their profile is missing a Lodging
  // section it can never have.
  if (
    query.data.lodging.data == null &&
    query.data.calls.data == null &&
    query.data.healthcareServices.data == null &&
    query.data.providerAttributes.data == null
  )
    return null

  return (
    <IndustryEditor
      locationId={locationId}
      state={query.data}
      disabled={disabled}
      publishReason={editReason ?? publishReason}
    />
  )
}

function IndustryEditor({
  locationId,
  state,
  disabled,
  publishReason,
}: {
  locationId: string
  state: IndustryState
  disabled: boolean
  publishReason: string | null
}) {
  return (
    <div className="flex flex-col gap-8">

      <section className="flex max-w-2xl flex-col gap-4">
        <h3 className="text-title font-medium">Lodging</h3>
        <SectionPanel title="Lodging" result={state.lodging}>
          {(data) => (
            <LodgingSection
              locationId={locationId}
              loaded={data as RawRecord}
              suggested={
                state.lodgingUpdated.error
                  ? null
                  : ((state.lodgingUpdated.data as RawRecord | null) ?? null)
              }
              suggestedError={state.lodgingUpdated.error}
              disabled={disabled}
              publishReason={publishReason}
            />
          )}
        </SectionPanel>
      </section>

      <section className="flex max-w-xs flex-col gap-4">
        <h3 className="text-title font-medium">Business calls</h3>
        <SectionPanel title="Business calls" result={state.calls}>
          {(data) => (
            <BusinessCallsSection
              locationId={locationId}
              loaded={data as RawRecord}
              disabled={disabled}
              publishReason={publishReason}
            />
          )}
        </SectionPanel>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-title font-medium">Healthcare</h3>
        <p className="text-caption text-muted-foreground">
          Google holds healthcare service and provider details for this listing
          that can&apos;t be edited here yet.
        </p>
        <SectionPanel
          title="Healthcare services"
          result={state.healthcareServices}
        >
          {(data) => <HealthcareServicesReadOnly data={data as RawRecord} />}
        </SectionPanel>
        <SectionPanel
          title="Provider attributes"
          result={state.providerAttributes}
        >
          {(data) => <ProviderAttributesReadOnly data={data as RawRecord} />}
        </SectionPanel>
      </section>
    </div>
  )
}

// --- Lodging -----------------------------------------------------------
type AmenitySection =
  | "pets"
  | "parking"
  | "accessibility"
  | "connectivity"
  | "foodAndDrink"
  | "housekeeping"
  | "wellness"
  | "pools"

function AmenityToggle({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-ui" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

function LodgingSection({
  locationId,
  loaded,
  suggested,
  suggestedError,
  disabled,
  publishReason,
}: {
  locationId: string
  loaded: RawRecord
  suggested: RawRecord | null
  suggestedError: string | null
  disabled: boolean
  publishReason: string | null
}) {
  // Google-direct resources carry no revision; the loaded record's identity
  // (a new object per refetch) is the "server value changed" token.
  const [draft, setDraft] = useResetOnRevision<RawRecord>(loaded, loaded)
  const toasts = useToastManager()

  const policies = asRecord(draft.policies)
  const pets = asRecord(draft.pets)
  const parking = asRecord(draft.parking)
  const accessibility = asRecord(draft.accessibility)
  const connectivity = asRecord(draft.connectivity)
  const foodAndDrink = asRecord(draft.foodAndDrink)
  const housekeeping = asRecord(draft.housekeeping)
  const wellness = asRecord(draft.wellness)
  const pools = asRecord(draft.pools)

  // Top-level keys the user actually touched (D8: everything else on the
  // record, including unknown sibling keys of `policies`, is preserved
  // as-is via the spread in the onChange handlers below).
  const mask = useMemo(() => touchedMask(loaded, draft), [loaded, draft])
  const payload = useMemo(
    () => Object.fromEntries(mask.map((key) => [key, draft[key]])),
    [mask, draft]
  )

  const save = useResourceMutation({
    mutationFn: () =>
      publishIndustry(locationId, {
        operation: "update_lodging",
        updateMask: mask,
        payload,
      }),
    invalidate: [queryKeys.locationIndustry(locationId)],
    successToast: "Lodging details published to Google",
  })

  const checkinId = useId()
  const checkoutId = useId()
  const baseId = useId()

  const suggestedPaths = suggested ? lodgingUpdatedPaths(suggested) : []

  function setPolicyTime(key: "checkinTime" | "checkoutTime", value: string) {
    setDraft((prev) => ({
      ...prev,
      policies: {
        ...asRecord(prev.policies),
        [key]: value ? inputToTimeOfDay(value) : undefined,
      },
    }))
  }

  function setNested(section: AmenitySection, key: string, value: boolean) {
    setDraft((prev) => ({
      ...prev,
      [section]: { ...asRecord(prev[section]), [key]: value },
    }))
  }

  function applySuggested() {
    if (!suggested || suggestedPaths.length === 0) return
    setDraft((prev) => {
      const next = { ...prev }
      for (const path of suggestedPaths) {
        const top = path.split(".")[0] ?? path
        if (top === "name" || top === "metadata" || top === "diffMask") continue
        if (top in suggested) next[top] = suggested[top]
      }
      return next
    })
    toasts.add({
      title: "Suggested lodging values applied to the form — review and save",
      type: "success",
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {suggestedError ? (
        <p className="text-caption text-muted-foreground">
          Google suggested lodging updates could not be loaded right now.
        </p>
      ) : suggestedPaths.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-(--np-radius-card) border border-border px-3 py-2">
          <p className="text-ui font-medium">
            Google suggested lodging updates
          </p>
          <p className="text-caption text-muted-foreground">
            Google suggests changes to{" "}
            {suggestedPaths.map((path) => path.replace(/_/g, " ")).join(", ")}.
            Apply them into this form, review, then save to publish.
          </p>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={applySuggested}
            >
              Apply suggested values
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-caption text-muted-foreground">
          Google has not suggested lodging changes.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={checkinId}>Check-in time</FieldLabel>
          <Input
            id={checkinId}
            type="time"
            value={timeOfDayToInput(policies.checkinTime)}
            disabled={disabled}
            onChange={(e) => setPolicyTime("checkinTime", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={checkoutId}>Check-out time</FieldLabel>
          <Input
            id={checkoutId}
            type="time"
            value={timeOfDayToInput(policies.checkoutTime)}
            disabled={disabled}
            onChange={(e) => setPolicyTime("checkoutTime", e.target.value)}
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-ui font-medium">Pets and parking</legend>
        <AmenityToggle
          id={`${baseId}-pets`}
          label="Pets allowed"
          checked={Boolean(pets.petsAllowed)}
          disabled={disabled}
          onChange={(v) => setNested("pets", "petsAllowed", v)}
        />
        <AmenityToggle
          id={`${baseId}-pets-free`}
          label="Pets allowed free of charge"
          checked={Boolean(pets.petsAllowedFree)}
          disabled={disabled}
          onChange={(v) => setNested("pets", "petsAllowedFree", v)}
        />
        <AmenityToggle
          id={`${baseId}-parking`}
          label="Parking available"
          checked={Boolean(parking.parkingAvailable)}
          disabled={disabled}
          onChange={(v) => setNested("parking", "parkingAvailable", v)}
        />
        <AmenityToggle
          id={`${baseId}-free-parking`}
          label="Free parking"
          checked={Boolean(parking.freeParking)}
          disabled={disabled}
          onChange={(v) => setNested("parking", "freeParking", v)}
        />
        <AmenityToggle
          id={`${baseId}-valet`}
          label="Valet parking"
          checked={Boolean(parking.valetParkingAvailable)}
          disabled={disabled}
          onChange={(v) => setNested("parking", "valetParkingAvailable", v)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-ui font-medium">Accessibility</legend>
        <AmenityToggle
          id={`${baseId}-entrance`}
          label="Step-free / accessible entrance"
          checked={Boolean(accessibility.mobilityAccessibleEntrance)}
          disabled={disabled}
          onChange={(v) =>
            setNested("accessibility", "mobilityAccessibleEntrance", v)
          }
        />
        <AmenityToggle
          id={`${baseId}-access-parking`}
          label="Accessible parking"
          checked={Boolean(accessibility.mobilityAccessibleParking)}
          disabled={disabled}
          onChange={(v) =>
            setNested("accessibility", "mobilityAccessibleParking", v)
          }
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-ui font-medium">Connectivity</legend>
        <AmenityToggle
          id={`${baseId}-wifi`}
          label="Wi‑Fi available"
          checked={Boolean(connectivity.wifiAvailable)}
          disabled={disabled}
          onChange={(v) => setNested("connectivity", "wifiAvailable", v)}
        />
        <AmenityToggle
          id={`${baseId}-free-wifi`}
          label="Free Wi‑Fi"
          checked={Boolean(connectivity.freeWifi)}
          disabled={disabled}
          onChange={(v) => setNested("connectivity", "freeWifi", v)}
        />
        <AmenityToggle
          id={`${baseId}-public-wifi`}
          label="Public-area Wi‑Fi"
          checked={Boolean(connectivity.publicAreaWifiAvailable)}
          disabled={disabled}
          onChange={(v) =>
            setNested("connectivity", "publicAreaWifiAvailable", v)
          }
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-ui font-medium">
          Food, wellness, and housekeeping
        </legend>
        <AmenityToggle
          id={`${baseId}-breakfast`}
          label="Breakfast available"
          checked={Boolean(foodAndDrink.breakfastAvailable)}
          disabled={disabled}
          onChange={(v) => setNested("foodAndDrink", "breakfastAvailable", v)}
        />
        <AmenityToggle
          id={`${baseId}-free-breakfast`}
          label="Free breakfast"
          checked={Boolean(foodAndDrink.freeBreakfast)}
          disabled={disabled}
          onChange={(v) => setNested("foodAndDrink", "freeBreakfast", v)}
        />
        <AmenityToggle
          id={`${baseId}-restaurant`}
          label="On-site restaurant"
          checked={Boolean(foodAndDrink.restaurant)}
          disabled={disabled}
          onChange={(v) => setNested("foodAndDrink", "restaurant", v)}
        />
        <AmenityToggle
          id={`${baseId}-fitness`}
          label="Fitness centre"
          checked={Boolean(wellness.fitnessCenter)}
          disabled={disabled}
          onChange={(v) => setNested("wellness", "fitnessCenter", v)}
        />
        <AmenityToggle
          id={`${baseId}-pool`}
          label="Pool"
          checked={Boolean(pools.pool)}
          disabled={disabled}
          onChange={(v) => setNested("pools", "pool", v)}
        />
        <AmenityToggle
          id={`${baseId}-housekeeping`}
          label="Housekeeping available"
          checked={Boolean(housekeeping.housekeepingAvailable)}
          disabled={disabled}
          onChange={(v) =>
            setNested("housekeeping", "housekeepingAvailable", v)
          }
        />
        <AmenityToggle
          id={`${baseId}-daily-housekeeping`}
          label="Daily housekeeping"
          checked={Boolean(housekeeping.dailyHousekeeping)}
          disabled={disabled}
          onChange={(v) => setNested("housekeeping", "dailyHousekeeping", v)}
        />
      </fieldset>

      <div>
        <Button
          onClick={() => save.mutate()}
          disabled={
            disabled ||
            Boolean(publishReason) ||
            mask.length === 0 ||
            save.isPending
          }
        >
          {save.isPending ? "Saving…" : "Save lodging"}
        </Button>
      </div>
      <GateNote reason={disabled ? null : publishReason} />
    </div>
  )
}

// --- Business calls ------------------------------------------------------
const CALLS_STATES = ["ENABLED", "DISABLED"] as const

function BusinessCallsSection({
  locationId,
  loaded,
  disabled,
  publishReason,
}: {
  locationId: string
  loaded: RawRecord
  disabled: boolean
  publishReason: string | null
}) {
  const initial = asString(loaded.callsState) || "ENABLED"
  // The loaded value is its own revision token: local edits survive until a
  // refetch actually changes it.
  const [callsState, setCallsState] = useResetOnRevision(initial, initial)

  const dirty = callsState !== initial

  const save = useResourceMutation({
    // The server 422s business_calls_mask_invalid for any mask other than
    // exactly ["callsState"] — hard-code it rather than deriving it.
    mutationFn: () =>
      publishIndustry(locationId, {
        operation: "update_business_calls",
        updateMask: ["callsState"],
        payload: { callsState },
      }),
    invalidate: [queryKeys.locationIndustry(locationId)],
    successToast: "Calls setting published to Google",
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-ui font-medium">
            Accept calls from customers
          </span>
          <Badge variant={initial === "ENABLED" ? "success" : "outline"}>
            Currently {callsStateLabel(initial)}
          </Badge>
        </div>
        <Select
          value={callsState}
          onValueChange={(value: string | null) =>
            value && setCallsState(value)
          }
          disabled={disabled}
        >
          <SelectTrigger aria-label="Calls">
            <SelectValue>
              {(value: string | null) => (value ? callsStateLabel(value) : "")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CALLS_STATES.map((value) => (
              <SelectItem key={value} value={value}>
                {callsStateLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Button
          onClick={() => save.mutate()}
          disabled={
            disabled || Boolean(publishReason) || !dirty || save.isPending
          }
        >
          {save.isPending ? "Saving…" : "Save calls"}
        </Button>
      </div>
      <GateNote reason={disabled ? null : publishReason} />
    </div>
  )
}

// --- Healthcare (read-only; §12 — no typed editor yet) --------------------
function HealthcareServicesReadOnly({ data }: { data: RawRecord }) {
  const count = Array.isArray(data.services) ? data.services.length : 0
  return (
    <div className="flex flex-col gap-0.5 text-ui">
      <span className="font-medium">Healthcare services</span>
      <span className="text-caption text-muted-foreground">
        {count > 0
          ? `Google lists ${count} service${count === 1 ? "" : "s"} for this listing. `
          : ""}
        Not editable here yet.
      </span>
    </div>
  )
}

function ProviderAttributesReadOnly({ data }: { data: RawRecord }) {
  const hasAttributes = Object.keys(data).length > 0
  return (
    <div className="flex flex-col gap-0.5 text-ui">
      <span className="font-medium">Provider attributes</span>
      <span className="text-caption text-muted-foreground">
        {hasAttributes
          ? "Google holds provider attributes for this listing. "
          : ""}
        Not editable here yet.
      </span>
    </div>
  )
}
