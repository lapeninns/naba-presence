"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useId, useMemo, useRef, useState } from "react"

import { SectionPanel } from "@/components/locations/section-panel"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToastManager } from "@/components/ui/toast"
import { publishIndustry, type IndustryState } from "@/lib/api/location-industry"
import { describeActionError } from "@/lib/locations/action-errors"
import { callsStateLabel } from "@/lib/locations/console-labels"
import { touchedMask } from "@/lib/locations/forms/industry"
import { editDisabledReason, publishDisabledReason, type LocationCapabilities } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useIndustry } from "@/lib/queries/use-location-industry"

// --- raw Google leaf -> typed accessor helpers -----------------------------
// `lodging`/healthcare sub-resources arrive as passthrough records (D8) —
// these read known leaves defensively without ever assuming a shape.
type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {}
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

type ToastFn = (title: string, type: "success" | "error") => void

export function IndustryTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const capsQuery = useLocationCapabilities(locationId)
  const caps = capsQuery.data
  // D4: the GET is owner/admin-only server-side — gate the query itself on
  // canEditCanonical so a non-owner/admin never fires the 403 request. `caps`
  // is undefined while the capabilities query is still pending, which keeps
  // `enabled` false (not a false positive) until we actually know the role.
  const industryQuery = useIndustry(locationId, { enabled: caps?.canEditCanonical === true })

  if (capsQuery.isPending) return <TabLoading />
  if (caps?.canEditCanonical !== true) {
    return <Empty title="This section is available to owners and admins" />
  }
  if (industryQuery.isPending) return <TabLoading />
  if (industryQuery.isError) return <TabError error={industryQuery.error} onRetry={() => industryQuery.refetch()} />

  return (
    <IndustryTabLoaded
      locationId={locationId}
      state={industryQuery.data}
      caps={caps}
      invalidate={() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.locationIndustry(locationId) })
      }}
      toast={(title, type) => toasts.add({ title, type })}
    />
  )
}

function IndustryTabLoaded({
  locationId,
  state,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  state: IndustryState
  caps: LocationCapabilities
  invalidate: () => void
  toast: ToastFn
}) {
  const editReason = editDisabledReason(caps)
  const publishReason = editReason ?? publishDisabledReason(caps, state.writesEnabled)

  return (
    <div className="flex flex-col gap-8">
      <GateNote reason={editReason} />

      <section className="flex max-w-sm flex-col gap-4">
        <h2 className="text-title font-semibold">Lodging</h2>
        <SectionPanel title="Lodging" result={state.lodging}>
          {(data) => (
            <LodgingSection
              locationId={locationId}
              loaded={data as RawRecord}
              disabled={Boolean(editReason)}
              publishReason={publishReason}
              invalidate={invalidate}
              toast={toast}
            />
          )}
        </SectionPanel>
      </section>

      <section className="flex max-w-xs flex-col gap-4">
        <h2 className="text-title font-semibold">Business calls</h2>
        <SectionPanel title="Business calls" result={state.calls}>
          {(data) => (
            <BusinessCallsSection
              locationId={locationId}
              loaded={data as RawRecord}
              disabled={Boolean(editReason)}
              publishReason={publishReason}
              invalidate={invalidate}
              toast={toast}
            />
          )}
        </SectionPanel>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-title font-semibold">Healthcare</h2>
        <p className="text-caption text-muted-foreground">
          Google holds healthcare service and provider details for this listing that can&apos;t be edited here yet.
        </p>
        <SectionPanel title="Healthcare services" result={state.healthcareServices}>
          {(data) => <HealthcareServicesReadOnly data={data as RawRecord} />}
        </SectionPanel>
        <SectionPanel title="Provider attributes" result={state.providerAttributes}>
          {(data) => <ProviderAttributesReadOnly data={data as RawRecord} />}
        </SectionPanel>
      </section>
    </div>
  )
}

// --- Lodging -----------------------------------------------------------
function LodgingSection({
  locationId,
  loaded,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  loaded: RawRecord
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const [draft, setDraft] = useState<RawRecord>(loaded)
  // idiom (b): setState-in-effect -> ref-guard. Only reset local edits when
  // the loaded resource actually changes (e.g. a refetch after a successful
  // publish), not on every incidental re-render of `loaded`.
  const loadedRef = useRef(loaded)
  useEffect(() => {
    if (loadedRef.current === loaded) return
    loadedRef.current = loaded
    setDraft(loaded)
  }, [loaded])

  const policies = asRecord(draft.policies)
  // Top-level keys the user actually touched (D8: everything else on the
  // record, including unknown sibling keys of `policies`, is preserved
  // as-is via the spread in the onChange handlers below).
  const mask = useMemo(() => touchedMask(loaded, draft), [loaded, draft])
  const payload = useMemo(() => Object.fromEntries(mask.map((key) => [key, draft[key]])), [mask, draft])

  const save = useMutation({
    mutationFn: () => publishIndustry(locationId, { operation: "update_lodging", updateMask: mask, payload }),
    onSuccess: () => {
      invalidate()
      toast("Lodging details published to Google", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const checkinId = useId()
  const checkoutId = useId()

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor={checkinId}>Check-in time</FieldLabel>
        <Input
          id={checkinId}
          type="time"
          value={asString(policies.checkinTime)}
          disabled={disabled}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, policies: { ...asRecord(prev.policies), checkinTime: e.target.value } }))
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={checkoutId}>Check-out time</FieldLabel>
        <Input
          id={checkoutId}
          type="time"
          value={asString(policies.checkoutTime)}
          disabled={disabled}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, policies: { ...asRecord(prev.policies), checkoutTime: e.target.value } }))
          }
        />
      </Field>
      <div>
        <Button
          onClick={() => save.mutate()}
          disabled={disabled || Boolean(publishReason) || mask.length === 0 || save.isPending}
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
  invalidate,
  toast,
}: {
  locationId: string
  loaded: RawRecord
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const initial = asString(loaded.callsState) || "ENABLED"
  const [callsState, setCallsState] = useState(initial)
  // idiom (b): ref-guard, as above.
  const initialRef = useRef(initial)
  useEffect(() => {
    if (initialRef.current === initial) return
    initialRef.current = initial
    setCallsState(initial)
  }, [initial])

  const dirty = callsState !== initial

  const save = useMutation({
    // The server 422s business_calls_mask_invalid for any mask other than
    // exactly ["callsState"] — hard-code it rather than deriving it.
    mutationFn: () =>
      publishIndustry(locationId, { operation: "update_business_calls", updateMask: ["callsState"], payload: { callsState } }),
    onSuccess: () => {
      invalidate()
      toast("Calls setting published to Google", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-ui font-medium">Accept calls from customers</span>
          <Badge variant={initial === "ENABLED" ? "success" : "outline"}>Currently {callsStateLabel(initial)}</Badge>
        </div>
        <Select value={callsState} onValueChange={(value: string | null) => value && setCallsState(value)} disabled={disabled}>
          <SelectTrigger aria-label="Calls">
            <SelectValue>{(value: string | null) => (value ? callsStateLabel(value) : "")}</SelectValue>
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
        <Button onClick={() => save.mutate()} disabled={disabled || Boolean(publishReason) || !dirty || save.isPending}>
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
        {count > 0 ? `Google lists ${count} service${count === 1 ? "" : "s"} for this listing. ` : ""}
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
        {hasAttributes ? "Google holds provider attributes for this listing. " : ""}
        Not editable here yet.
      </span>
    </div>
  )
}
