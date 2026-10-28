"use client"

import { MapPin } from "lucide-react"
import { useId, useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { QueryPending } from "@/components/ui/query-states"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { ApiClientError } from "@/lib/api/client"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import { resolveImportSource } from "@/lib/connections/import-source"
import { useClientMutations } from "@/lib/queries/use-clients"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { useGoogleLocations } from "@/lib/queries/use-google-locations"
import { useLocationImport } from "@/lib/queries/use-location-import"
import {
  useLocationDirectory,
  type DirectoryEntry,
} from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { describeActionError } from "@/lib/errors/action-errors"
import type { DiscoveredLocation } from "@/lib/api/google-locations"

type RowState = "idle" | "pending" | "imported" | { error: string }

/**
 * The locations Google knows about under the working account, one row each:
 * name, address, and the next action. A location not yet in NabaPresence can
 * be imported. One already imported, but not filed under this client, can be
 * filed or moved here — "linked" on its own only means the Google listing
 * was imported, not that this client owns it.
 */
export function ImportCard({
  clientId,
  connectionId: clientConnectionId,
  onChooseAccounts,
}: {
  clientId?: string
  /** The login this client's setup attached; the org's first one otherwise. */
  connectionId?: string | null
  /** Opens the step where accounts are switched on, when there is one. */
  onChooseAccounts?: () => void
} = {}) {
  const business = useWorkspaceMode() === "business"
  const workspace = useConnectionWorkspace()
  const connections = workspace.query.data?.connections ?? []
  const connectionId =
    clientConnectionId ??
    deriveAutoSelection({
      connections: connections.map((c) => ({ id: c.id, status: c.status })),
      accounts: [],
      selectedConnectionId: null,
      selectedAccountName: null,
    }).connectionId
  const accounts = useGoogleAccounts(connectionId)
  const [chosenAccountName, setChosenAccountName] = useState<string | null>(
    null
  )
  const { activeAccounts, accountName } = resolveImportSource({
    accounts: accounts.query.data?.accounts ?? [],
    connectionId,
    chosenAccountName,
  })

  const discovery = useGoogleLocations(accountName)
  // Read the directory through the shared hook rather than writing a second,
  // differently-shaped value into the same query key: this card and
  // LocationsIndex live in one QueryClient, and whichever wrote last used to
  // win.
  const managed = useLocationDirectory(useSessionRole())
  const { link } = useLocationImport()
  const { assignLocations } = useClientMutations()
  const headingId = useId()

  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  // null until the operator ticks or unticks something (see `checked`).
  const [selection, setSelection] = useState<string[] | null>(null)
  const [bulkPending, setBulkPending] = useState(false)
  const [relinkTarget, setRelinkTarget] = useState<DiscoveredLocation | null>(
    null
  )
  const [moveTarget, setMoveTarget] = useState<{
    discoveredId: string
    locationId: string
    title: string
    fromName: string | null
  } | null>(null)

  const directoryByExternal = new Map(
    (managed.data ?? [])
      .filter(
        (
          location
        ): location is DirectoryEntry & { externalLocationId: string } =>
          Boolean(location.externalLocationId)
      )
      .map((location) => [location.externalLocationId, location])
  )

  const importOne = async (
    location: DiscoveredLocation,
    confirmRelink: boolean
  ) => {
    setRowState((prev) => ({ ...prev, [location.id]: "pending" }))
    try {
      await link.mutateAsync({
        externalLocationId: location.id,
        confirmRelink,
        ...(clientId ? { clientId } : {}),
      })
      setRowState((prev) => ({ ...prev, [location.id]: "imported" }))
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "relink_confirmation_required"
      ) {
        setRowState((prev) => ({ ...prev, [location.id]: "idle" }))
        setRelinkTarget(location)
        return
      }
      setRowState((prev) => ({
        ...prev,
        [location.id]: { error: describeActionError(error) },
      }))
    }
  }

  const fileUnderClient = async (discoveredId: string, locationId: string) => {
    if (!clientId) return
    setRowState((prev) => ({ ...prev, [discoveredId]: "pending" }))
    try {
      await assignLocations.mutateAsync({
        clientId,
        locationIds: [locationId],
      })
      setRowState((prev) => ({ ...prev, [discoveredId]: "imported" }))
    } catch (error) {
      setRowState((prev) => ({
        ...prev,
        [discoveredId]: { error: describeActionError(error) },
      }))
    }
  }

  const heading = (
    <>
      {/* An h3 under the setup step’s own h2 (“Link … listings”). */}
      <h3 id={headingId} className="text-title font-semibold text-ink">
        Listings on Google
      </h3>
      {activeAccounts.length > 1 && accountName ? (
        <SegmentedControl
          value={accountName}
          onValueChange={setChosenAccountName}
          aria-label="Business Profile account"
          className="max-w-full"
        >
          {activeAccounts.map((account) => (
            <SegmentedControlItem
              key={account.googleAccountName}
              value={account.googleAccountName}
              className="flex-none"
            >
              {account.accountName || account.googleAccountName}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      ) : null}
    </>
  )

  const chooseAccounts = onChooseAccounts ? (
    <Button variant="secondary" onClick={onChooseAccounts}>
      Choose accounts
    </Button>
  ) : null

  // The accounts load is named here, once, with its retry: the drafts section
  // below reads the same query and points back to this one.
  if (accounts.query.isError) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {heading}
        {/* As on the Account step: announced once, Try again outside the
            alert and showing it is running (each retry is one rate-limited
            discovery). */}
        <Empty
          variant="error"
          role="alert"
          title="We couldn’t load your Google accounts"
          description={describeActionError(accounts.query.error)}
          actions={
            <Button
              variant="secondary"
              pending={accounts.query.isFetching}
              pendingLabel="Trying again…"
              onClick={() => void accounts.query.refetch()}
            >
              Try again
            </Button>
          }
        />
      </section>
    )
  }
  if (accounts.query.isPending) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {heading}
        <QueryPending label="Loading Google accounts…" />
      </section>
    )
  }
  // Loaded, and none of this login's accounts is switched on.
  if (!accountName) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {heading}
        <Empty
          title="Choose a Google account"
          description="Switch on at least one Business Profile account for this Google login to see its listings."
          action={chooseAccounts}
        />
      </section>
    )
  }
  if (discovery.isPending) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {heading}
        <QueryPending label="Finding listings on Google…" />
      </section>
    )
  }
  if (discovery.isError) {
    // The account switcher stays, so one account Google will not list does
    // not strand the others.
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {heading}
        <Empty
          variant="error"
          role="alert"
          title="We couldn’t find this account’s listings"
          description={describeActionError(discovery.error)}
          actions={
            <Button
              variant="secondary"
              pending={discovery.isFetching}
              pendingLabel="Trying again…"
              onClick={() => void discovery.refetch()}
            >
              Try again
            </Button>
          }
        />
      </section>
    )
  }
  if (discovery.data.locations.length === 0) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {heading}
        <Empty
          icon={<MapPin />}
          title="No listings to link"
          description="This account has no Business Profile listings. If the business is under another account, change it in Accounts, or search for it below."
          action={chooseAccounts}
        />
      </section>
    )
  }

  // What a row needs, worked out once for the list and the bulk action.
  const rows = discovery.data.locations.map((location) => {
    const existing = directoryByExternal.get(location.id)
    const state = rowState[location.id] ?? "idle"
    // Without a client, imported is enough. With a client, the listing
    // still has to be filed under that client before the step is done.
    const filedHere = clientId
      ? existing?.clientId === clientId
      : Boolean(existing)
    const done = filedHere || state === "imported"
    const needsFiling =
      Boolean(clientId) &&
      existing !== undefined &&
      existing.clientId !== clientId &&
      !done
    // Linkable in bulk: new to NabaPresence, or imported but not filed under
    // any client. Moving one away from another client stays a single,
    // confirmed action.
    const selectable =
      !done && (!existing || (needsFiling && !existing.clientId))
    return { location, existing, state, done, needsFiling, selectable }
  })
  const selectableIds = rows
    .filter((row) => row.selectable)
    .map((row) => row.location.id)
  // Until the operator changes it, the selection is the verified listings:
  // the ones Google will actually serve reviews for.
  const checked = new Set(
    (
      selection ??
      rows
        .filter((row) => row.selectable && row.location.verified)
        .map((row) => row.location.id)
    ).filter((id) => selectableIds.includes(id))
  )
  const toggle = (id: string) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelection([...next])
  }
  const linkOne = (row: (typeof rows)[number]) =>
    row.existing
      ? fileUnderClient(row.location.id, row.existing.id)
      : importOne(row.location, false)
  const linkSelected = async () => {
    setBulkPending(true)
    // One at a time: each link is its own Google round trip, and a relink
    // confirmation for one listing must not race the others.
    for (const row of rows) {
      if (checked.has(row.location.id)) await linkOne(row)
    }
    setSelection([])
    setBulkPending(false)
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {heading}
      {selectableIds.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-caption text-ink-muted">
            Tick the listings that belong here. Verified listings are ticked for
            you.
          </p>
          <Button
            size="sm"
            disabled={checked.size === 0 || bulkPending}
            pending={bulkPending}
            pendingLabel="Linking…"
            onClick={() => void linkSelected()}
          >
            Link selected ({checked.size})
          </Button>
        </div>
      ) : null}
      <GroupedList aria-label="Listings found on Google">
        {rows.map(
          ({ location, existing, state, done, needsFiling, selectable }) => {
            return (
              <GroupedListItem
                key={location.id}
                icon={<MapPin />}
                label={
                  <span className="flex items-center gap-2">
                    {selectable ? (
                      <Checkbox
                        checked={checked.has(location.id)}
                        disabled={state === "pending" || bulkPending}
                        onCheckedChange={() => toggle(location.id)}
                        aria-label={`Select ${location.title}`}
                      />
                    ) : null}
                    <span className="truncate">{location.title}</span>
                    {location.verified ? (
                      <Badge variant="success" shape="tag">
                        Verified
                      </Badge>
                    ) : null}
                  </span>
                }
                description={
                  <>
                    {location.address || "No address on Google"}
                    {typeof state === "object" ? (
                      <>
                        {" · "}
                        <span role="alert" className="text-danger-ink">
                          {state.error}
                        </span>
                      </>
                    ) : null}
                  </>
                }
                trailing={
                  done ? (
                    <Badge variant="tinted">Linked</Badge>
                  ) : needsFiling && existing ? (
                    <>
                      <Badge variant="secondary">
                        {existing.clientId
                          ? business
                            ? "Filed elsewhere"
                            : "Another client"
                          : "Not filed"}
                      </Badge>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={state === "pending" || bulkPending}
                        aria-label={
                          existing.clientId
                            ? `Move ${location.title} to ${business ? "your business" : "this client"}`
                            : `Link ${location.title} to ${business ? "your business" : "this client"}`
                        }
                        onClick={() => {
                          if (existing.clientId) {
                            setMoveTarget({
                              discoveredId: location.id,
                              locationId: existing.id,
                              title: location.title,
                              fromName: existing.clientName ?? null,
                            })
                            return
                          }
                          void fileUnderClient(location.id, existing.id)
                        }}
                      >
                        {state === "pending"
                          ? existing.clientId
                            ? "Moving…"
                            : "Linking…"
                          : existing.clientId
                            ? "Move here"
                            : "Link"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge variant="secondary">Not linked</Badge>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={state === "pending" || bulkPending}
                        aria-label={`Link ${location.title}`}
                        onClick={() => importOne(location, false)}
                      >
                        {state === "pending" ? "Linking…" : "Link"}
                      </Button>
                    </>
                  )
                }
              />
            )
          }
        )}
      </GroupedList>

      <OverwriteConfirmDialog
        open={relinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRelinkTarget(null)
        }}
        title={`Move ${relinkTarget?.title ?? "this location"}’s history?`}
        description="This Google location is linked to another location. Confirming moves the link and its historical reviews here."
        confirmLabel="Confirm and link"
        requireAcknowledgement
        acknowledgementLabel="I understand historical reviews will move to this location."
        pending={link.isPending}
        onConfirm={() => {
          if (relinkTarget) {
            const target = relinkTarget
            setRelinkTarget(null)
            void importOne(target, true)
          }
        }}
      />
      <OverwriteConfirmDialog
        open={moveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMoveTarget(null)
        }}
        title={`Move ${moveTarget?.title ?? "this listing"} to ${business ? "your business" : "this client"}?`}
        description={
          moveTarget?.fromName && !business
            ? `${moveTarget.title} is filed under ${moveTarget.fromName}. Moving it keeps its reviews with the listing.`
            : "Moving it keeps its reviews with the listing."
        }
        confirmLabel="Move here"
        requireAcknowledgement={false}
        pending={assignLocations.isPending}
        onConfirm={() => {
          if (moveTarget) {
            const target = moveTarget
            setMoveTarget(null)
            void fileUnderClient(target.discoveredId, target.locationId)
          }
        }}
      />
    </section>
  )
}
