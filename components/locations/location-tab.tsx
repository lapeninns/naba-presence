"use client"

/**
 * LocationTab — the one shell for every per-location tab (Sprint 4.1).
 *
 * Owns, in order: capabilities → optional gate → resource fetch → pending /
 * error (with retry) → loaded. Tabs stop re-implementing that chain and become
 * a render function that receives `{ data, caps, disabled, editReason,
 * publishReason }`.
 *
 * Why a `useResource` HOOK prop rather than a query result: the gate must stop
 * the resource GET from ever being issued (owner/admin-only endpoints 403 for
 * members). The shell renders the resource branch only once the gate passes,
 * so the hook — and its query — is simply never mounted for a gated viewer.
 * No `enabled:` plumbing is required in the query hook any more.
 *
 * -------------------------------------------------------------------------
 * HOW TO MIGRATE A TAB (hours-tab.tsx as the example)
 * -------------------------------------------------------------------------
 *
 * BEFORE — the copy-pasted wrapper + drilled `invalidate`/`toast` pair:
 *
 *   export function HoursTab({ locationId }: { locationId: string }) {
 *     const queryClient = useQueryClient()
 *     const toasts = useToastManager()
 *     const hoursQuery = useHours(locationId)
 *     const caps = useLocationCapabilities(locationId).data
 *     if (hoursQuery.isPending) return <TabLoading />
 *     if (hoursQuery.isError) return <TabError error={hoursQuery.error} onRetry={() => hoursQuery.refetch()} />
 *     return (
 *       <HoursTabLoaded
 *         key={hoursQuery.data.canonicalResource.revision}
 *         hours={hoursQuery.data}
 *         caps={caps}
 *         invalidate={() => void queryClient.invalidateQueries({ queryKey: queryKeys.locationHours(locationId) })}
 *         toast={(title, type) => toasts.add({ title, type })}
 *       />
 *     )
 *   }
 *
 *   function HoursTabLoaded({ hours, caps, invalidate, toast, ... }) {
 *     const [draft, setDraft] = useState(hours.canonical)
 *     const revisionRef = useRef(hours.canonicalResource.revision)   // 8-line ref guard
 *     useEffect(() => { ... setDraft(hours.canonical) }, [...])
 *     const save = useMutation({
 *       mutationFn: () => saveHours(locationId, { ... }),
 *       onSuccess: () => { setFormError(null); invalidate(); toast("Opening hours saved", "success") },
 *       onError: (error) => { setFormError(describeActionError(error)); toast(describeActionError(error), "error") },
 *     })
 *     const editReason = editDisabledReason(caps)
 *     const publishReason = resourceDisabledReason(caps, "hours", hours.writesEnabled) ?? ...
 *     ...
 *   }
 *
 * AFTER — shell + useResourceMutation + useResetOnRevision:
 *
 *   export function HoursTab({ locationId }: { locationId: string }) {
 *     return (
 *       <LocationTab locationId={locationId} useResource={useHours} resource="hours">
 *         {({ data: hours, disabled, editReason, publishReason }) => (
 *           <HoursForm
 *             locationId={locationId}
 *             hours={hours}
 *             disabled={disabled}
 *             editReason={editReason}
 *             publishReason={publishReason ?? (hours.status === "in_sync" ? "Opening hours already match Google." : null)}
 *           />
 *         )}
 *       </LocationTab>
 *     )
 *   }
 *
 *   function HoursForm({ locationId, hours, disabled, editReason, publishReason }) {
 *     const [draft, setDraft] = useResetOnRevision(hours.canonical, hours.canonicalResource.revision)
 *     const save = useResourceMutation({
 *       mutationFn: () => saveHours(locationId, { expectedCanonicalRevision: hours.canonicalResource.revision, hours: draft }),
 *       invalidate: [queryKeys.locationHours(locationId)],
 *       successToast: "Opening hours saved",
 *       onSuccess: () => setFormError(null),
 *       onError: (_error, message) => setFormError(message),   // message === describeActionError(error)
 *     })
 *     ...
 *   }
 *
 * Gated tabs (industry, administration) add `requires="canEditCanonical"`; the
 * shell renders the "available to owners and admins" notice and never calls
 * `useResource`, so drop the `{ enabled }` option from the call site.
 *
 * Tabs whose state is a bag of `{ data, error }` sub-resources keep using
 * <SectionPanel> INSIDE the render function — the shell only owns the outer
 * fetch; `data` is the full state object.
 *
 * Rules for `useResource`: pass a module-level query hook (`useHours`,
 * `usePlaceActions`, …). It is called as a hook by the shell, so it must call
 * the same hooks on every render — never swap it for a different function
 * between renders.
 */

import type { ReactNode } from "react"

import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Empty } from "@/components/ui/empty"
import {
  GATED_SECTION_TITLE,
  gateSatisfied,
  tabGateReasons,
  type LocationCapabilities,
  type LocationGate,
  type TabGateReasons,
} from "@/lib/locations/gating"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"

/**
 * The part of a TanStack query result the shell reads. Any `UseQueryResult` is
 * assignable to it, and so is a hook that composes two queries into one state
 * (the merged profile editor needs both the canonical profile and the Google
 * business information before it can show a single draft).
 */
export type ResourceQuery<T> = {
  data: T | undefined
  isPending: boolean
  isError: boolean
  error: Error | null
  refetch: () => unknown
}

export type LocationTabRenderProps<T> = TabGateReasons & {
  /** The loaded resource (the query's `data`, never undefined here). */
  data: T
  /** Capabilities, or undefined while that query is still pending / failed. */
  caps: LocationCapabilities | undefined
}

export type LocationTabProps<T> = {
  locationId: string
  /** The resource query hook, e.g. `useHours`. Called by the shell once the gate passes. */
  useResource: (locationId: string) => ResourceQuery<T>
  /**
   * Capability resource key (`"hours"`, `"booking"`, …) used to derive
   * `publishReason` via `resourceDisabledReason`. Omit to fall back to the
   * plain publish gate.
   */
  resource?: string
  /**
   * Whether Google writes are enabled for this resource. Defaults to
   * `data.writesEnabled` when that is a boolean, else `true`.
   */
  writesEnabled?: (data: T) => boolean
  /** Capability the viewer must hold before the resource query is fired. */
  requires?: LocationGate
  /** Notice title shown when `requires` is not satisfied. */
  gatedTitle?: string
  children: (props: LocationTabRenderProps<T>) => ReactNode
}

function defaultWritesEnabled(data: unknown): boolean {
  const flag = (data as { writesEnabled?: unknown } | null)?.writesEnabled
  return typeof flag === "boolean" ? flag : true
}

export function LocationTab<T>({
  locationId,
  useResource,
  resource,
  writesEnabled,
  requires,
  gatedTitle,
  children,
}: LocationTabProps<T>) {
  const capsQuery = useLocationCapabilities(locationId)

  // A failed capabilities query is an honest retry for every tab: without the
  // role a gated tab cannot decide, and an ungated one would otherwise sit
  // with every control disabled and no reason shown.
  if (capsQuery.isError)
    return (
      <TabError
        error={capsQuery.error}
        onRetry={() => void capsQuery.refetch()}
      />
    )

  if (requires) {
    // The gate needs a known role: pending → skeleton, unsatisfied → notice.
    // In both the resource hook below is not mounted, so the owner/admin-only
    // GET is never issued.
    if (capsQuery.isPending) return <TabLoading />
    if (!gateSatisfied(capsQuery.data, requires))
      return <Empty title={gatedTitle ?? GATED_SECTION_TITLE} />
  }

  return (
    <LocationTabResource
      locationId={locationId}
      useResource={useResource}
      resource={resource}
      writesEnabled={writesEnabled}
      caps={capsQuery.data}
    >
      {children}
    </LocationTabResource>
  )
}

function LocationTabResource<T>({
  locationId,
  useResource,
  resource,
  writesEnabled,
  caps,
  children,
}: Pick<
  LocationTabProps<T>,
  "locationId" | "useResource" | "resource" | "writesEnabled" | "children"
> & {
  caps: LocationCapabilities | undefined
}) {
  const query = useResource(locationId)

  // Error first: a failed query has no data, so checking for data before the
  // error would show a skeleton forever instead of the retry.
  if (query.isError)
    return <TabError error={query.error} onRetry={() => void query.refetch()} />
  if (query.isPending || query.data === undefined) return <TabLoading />

  const data = query.data
  const enabled = writesEnabled
    ? writesEnabled(data)
    : defaultWritesEnabled(data)
  return (
    <>{children({ data, caps, ...tabGateReasons(caps, resource, enabled) })}</>
  )
}
