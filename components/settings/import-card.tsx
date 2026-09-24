"use client"

import { MapPin } from "lucide-react"
import { useId, useState } from "react"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiClientError } from "@/lib/api/client"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import { resolveImportSource } from "@/lib/connections/import-source"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { useGoogleLocations } from "@/lib/queries/use-google-locations"
import { useLocationImport } from "@/lib/queries/use-location-import"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { describeActionError } from "@/lib/errors/action-errors"
import type { DiscoveredLocation } from "@/lib/api/google-locations"

type RowState = "idle" | "pending" | "imported" | { error: string }

/**
 * The locations Google knows about under the working account, one row each:
 * name, address, whether it is linked here yet, and an Import action for the
 * ones that are not.
 */
export function ImportCard({
  clientId,
  connectionId: clientConnectionId,
}: {
  clientId?: string
  /** The login this client's setup attached; the org's first one otherwise. */
  connectionId?: string | null
} = {}) {
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
  const headingId = useId()

  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [relinkTarget, setRelinkTarget] = useState<DiscoveredLocation | null>(
    null
  )

  const linkedExternalIds = new Set(
    (managed.data ?? [])
      .map((location) => location.externalLocationId)
      .filter((id): id is string => Boolean(id))
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

  const heading = (
    <>
      <h2 id={headingId} className="text-title font-semibold text-ink">
        Import locations
      </h2>
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

  if (!accountName) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {heading}
        <Empty
          title="Choose a Google account"
          description="Switch on at least one Business Profile account for this Google login to see its locations."
        />
      </section>
    )
  }
  if (discovery.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-[calc(var(--np-row-h)*3)] w-full rounded-(--np-radius-card)" />
      </div>
    )
  }
  if (discovery.isError) {
    // The account switcher stays, so one account Google will not list does
    // not strand the others.
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {heading}
        <Empty
          title="We couldn’t discover locations"
          description={describeActionError(discovery.error)}
          action={
            <Button variant="outline" onClick={() => discovery.refetch()}>
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
          title="No locations to import"
          description="This account has no Business Profile locations."
        />
      </section>
    )
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {heading}
      <GroupedList aria-label="Locations found on Google">
        {discovery.data.locations.map((location) => {
          const alreadyLinked = linkedExternalIds.has(location.id)
          const state = rowState[location.id] ?? "idle"
          const done = alreadyLinked || state === "imported"
          return (
            <GroupedListItem
              key={location.id}
              icon={<MapPin />}
              label={
                <span className="flex items-center gap-2">
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
                ) : (
                  <>
                    <Badge variant="secondary">Not linked</Badge>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={state === "pending"}
                      aria-label={`Import ${location.title}`}
                      onClick={() => importOne(location, false)}
                    >
                      {state === "pending" ? "Importing…" : "Import"}
                    </Button>
                  </>
                )
              }
            />
          )
        })}
      </GroupedList>

      <OverwriteConfirmDialog
        open={relinkTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRelinkTarget(null)
        }}
        title={`Move ${relinkTarget?.title ?? "this location"}’s history?`}
        description="This Google location was linked before. Confirming re-links it here and moves its historical reviews to this location."
        confirmLabel="Confirm and import"
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
    </section>
  )
}
