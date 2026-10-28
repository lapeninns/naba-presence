"use client"

import {
  ArchiveIcon,
  CircleAlertIcon,
  Link2Icon,
  MapPinIcon,
  PenLineIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { ClientColourField } from "@/components/clients/client-colour-field"
import { ActionBar } from "@/components/ui/action-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Empty } from "@/components/ui/empty"
import {
  Field,
  FieldCounter,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input, SearchInput } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { SettingsDestructiveAction } from "@/components/ui/settings-row"
import { Textarea } from "@/components/ui/textarea"
import { useOutcomeToast, type LocalToastOptions } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import {
  assignLocationsToClient,
  fetchClient,
  updateClient,
} from "@/lib/api/clients"
import type { ClientResponse, ClientSummary } from "@/lib/contracts/clients"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { DiscardDialog } from "@/components/editors/discard-dialog"
import { StashedEditsNotice } from "@/components/editors/stashed-edits-notice"
import { useDraftKey } from "@/lib/editors/use-draft-key"
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes"
import { formatAddressLine } from "@/lib/locations/address"
import { queryKeys } from "@/lib/queries/keys"
import {
  useClient,
  useClientMutations,
  useClients,
} from "@/lib/queries/use-clients"
import {
  useLocationDirectory,
  type DirectoryEntry,
} from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

const NOTES_MAX = 2000

/**
 * Filing more than this many listings at once asks first: a slip of "select
 * all" in a long unfiled list would otherwise file a whole agency's
 * backlog under one client.
 */
export const BULK_FILE_CONFIRM_THRESHOLD = 5

const SECTIONS = [
  { id: "details", label: "Details" },
  { id: "listings", label: "Listings" },
  { id: "archive", label: "Archive" },
]

type ClientDetails = {
  name: string
  notes: string | null
  colour: string | null
}

/**
 * Renaming, notes, colour, which listings belong here, and archiving.
 *
 * Listing assignment is the interesting half: listings arrive from Google
 * unassigned, and this is where they get filed. Assigning also extends access
 * to teammates who already hold every other listing of the client, because a
 * colleague who can see four of a client's five venues but not the fifth is a
 * support ticket, not a security boundary.
 *
 * Reference `client-settings.html`: a section rail beside the Details form,
 * the listings tables and the Archive danger card. On a narrow screen there
 * is no rail: the sections simply stack (an index of chevron rows that only
 * scrolled to a section right under it promised a pushed screen), and the
 * app bar carries the way back.
 */
function ClientSettings({ clientId }: { clientId: string }) {
  const query = useClient(clientId)

  if (query.isPending) {
    return (
      <>
        <SettingsHeader clientId={clientId} name={null} />
        <SettingsSkeleton />
      </>
    )
  }
  if (query.isError) {
    // The client endpoint answers not-found for an archived client (and for
    // one this session can no longer see): no retry will bring it back, so
    // point at where an archived client is restored instead.
    if (isClientNotFound(query.error)) {
      return (
        <>
          <SettingsHeader clientId={clientId} name={null} />
          <Card flush>
            <Empty
              titleAs="h2"
              icon={<ArchiveIcon />}
              title="This client isn’t available"
              description="It may have been archived. Archived clients can be restored from Clients › Archived."
              action={
                <>
                  <Link
                    href="/clients?view=archived"
                    className={cn(buttonVariants({ variant: "secondary" }))}
                  >
                    Archived clients
                  </Link>
                  <Link
                    href="/clients"
                    className={cn(buttonVariants({ variant: "ghost" }))}
                  >
                    All clients
                  </Link>
                </>
              }
            />
          </Card>
        </>
      )
    }
    return (
      <>
        <SettingsHeader clientId={clientId} name={null} />
        <Card flush>
          <Empty
            tone="bad"
            titleAs="h2"
            icon={<CircleAlertIcon />}
            title="We couldn't load this client's settings"
            description={`${describeActionError(query.error)} Nothing was changed.`}
            action={
              <Button
                variant="secondary"
                pending={query.isFetching}
                pendingLabel="Trying again…"
                onClick={() => void query.refetch()}
              >
                <RefreshCwIcon aria-hidden />
                Try again
              </Button>
            }
          />
        </Card>
      </>
    )
  }

  return <SettingsBody clientId={clientId} client={query.data.client} />
}

function SettingsHeader({
  clientId,
  name,
}: {
  clientId: string
  name: string | null
}) {
  // With unsaved details, the details form's leave guard holds this link.
  return (
    <PageHeader
      title="Client settings"
      eyebrow={name ?? "Client"}
      description="Rename the client, file its listings, or archive it."
      actions={
        <Link
          href={`/clients/${clientId}`}
          // The app bar carries the way back on a phone.
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "max-md:hidden"
          )}
        >
          {name ? `Back to ${name}` : "Back to client"}
        </Link>
      }
    />
  )
}

function SettingsBody({
  clientId,
  client,
}: {
  clientId: string
  client: ClientResponse["client"]
}) {
  const role = useSessionRole()
  const directory = useLocationDirectory(role)
  const clients = useClients()
  const { update, assignLocations, unassignLocations } = useClientMutations()
  const toast = useOutcomeToast()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState<string | null>(null)
  // Names the listing and the action, so an error far above a phone's row
  // still says which one failed.
  const [listingsError, setListingsError] = React.useState<{
    title: string
    description: string
  } | null>(null)
  const [unfiledQuery, setUnfiledQuery] = React.useState("")
  const [confirmBulk, setConfirmBulk] = React.useState(false)

  const unassigned = (directory.data ?? []).filter(
    (location) => !location.clientId
  )
  const mine = (directory.data ?? []).filter(
    (location) => location.clientId === clientId
  )
  const others = (clients.data?.items ?? []).filter(
    (entry) => entry.id !== clientId
  )
  const needle = unfiledQuery.trim().toLowerCase()
  const unfiledShown = needle
    ? unassigned.filter((location) =>
        `${location.name} ${formatAddressLine(location.address) ?? ""}`
          .toLowerCase()
          .includes(needle)
      )
    : unassigned

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll })
    void queryClient.invalidateQueries({ queryKey: queryKeys.locations })
    void queryClient.invalidateQueries({
      queryKey: queryKeys.locationsManagement,
    })
  }

  /**
   * Put a listing back under this client, for an Undo. Grants were never
   * removed. The same toast shows it running, then what the server said.
   */
  const refile = async (location: DirectoryEntry) => {
    const progress = toast.progress(
      `Putting ${location.name} back under ${client.name}…`
    )
    try {
      await assignLocationsToClient(clientId, {
        locationIds: [location.id],
        grantToClientMembers: false,
      })
      invalidate()
      progress.success(`${location.name} is back under ${client.name}`)
    } catch (error) {
      progress.error(`${location.name} wasn’t put back under ${client.name}`, {
        description: describeActionError(error),
      })
    }
  }

  const remove = async (location: DirectoryEntry) => {
    setBusy(location.id)
    setListingsError(null)
    try {
      await unassignLocations.mutateAsync({
        clientId,
        locationIds: [location.id],
      })
      // Undo runs once and closes this toast.
      toast.show({
        kind: "local",
        title: `${location.name} is now unfiled`,
        description: "Its reviews and Google link are unchanged.",
        undo: { onUndo: () => void refile(location) },
      })
    } catch (error) {
      setListingsError({
        title: `${location.name} wasn’t unfiled`,
        description: describeActionError(error),
      })
    } finally {
      setBusy(null)
    }
  }

  const move = async (location: DirectoryEntry, target: ClientSummary) => {
    setBusy(location.id)
    setListingsError(null)
    try {
      // Assigning to another client moves the listing: a listing belongs to
      // one client, and the assign endpoint takes it from whichever held it.
      await assignLocations.mutateAsync({
        clientId: target.id,
        locationIds: [location.id],
      })
      toast.show({
        kind: "local",
        title: `${location.name} moved to ${target.name}`,
        undo: { onUndo: () => void refile(location) },
      })
    } catch (error) {
      setListingsError({
        title: `${location.name} wasn’t moved to ${target.name}`,
        description: describeActionError(error),
      })
    } finally {
      setBusy(null)
    }
  }

  const assign = async () => {
    setListingsError(null)
    setConfirmBulk(false)
    const ids = [...selected]
    try {
      await assignLocations.mutateAsync({ clientId, locationIds: ids })
      toast.show({
        title:
          ids.length === 1
            ? `1 listing filed under ${client.name}`
            : `${formatNumber(ids.length)} listings filed under ${client.name}`,
      })
      setSelected(new Set())
    } catch (error) {
      setListingsError({
        title:
          ids.length === 1
            ? "That listing wasn’t filed"
            : "Those listings weren’t filed",
        description: describeActionError(error),
      })
    }
  }

  return (
    <>
      <SettingsHeader clientId={clientId} name={client.name} />
      <div className="flex flex-col gap-6 @3xl:flex-row @3xl:items-start">
        <nav
          aria-label="Client settings sections"
          className="hidden @3xl:sticky @3xl:top-(--np-toolbar-h) @3xl:block @3xl:w-52 @3xl:shrink-0 @3xl:pt-4"
        >
          <div className="hidden @3xl:flex @3xl:flex-col @3xl:gap-0.5">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="flex min-h-(--np-control-h) items-center rounded-(--np-radius-control) px-2.5 text-ui text-ink-secondary no-underline focus-halo hover:bg-fill"
              >
                {section.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <ClientDetailsForm
            client={client}
            onSave={async (input) => {
              const { client: saved } = await update.mutateAsync({
                clientId,
                ...input,
              })
              // The confirmed reply settles the form now: waiting for the
              // background refetch left the bar reading "Unsaved changes"
              // (and the leave guard armed) after the save had landed.
              queryClient.setQueryData<ClientResponse>(
                queryKeys.client(clientId),
                (old) => (old ? { ...old, client: saved } : old)
              )
              toast.show({ title: "Client updated" })
            }}
          />

          <section
            id="listings"
            aria-labelledby="client-listings-settings"
            className="flex scroll-mt-20 flex-col gap-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h2
                  id="client-listings-settings"
                  className="text-title font-semibold text-ink"
                >
                  Listings
                </h2>
                <p className="text-ui text-ink-muted">
                  {mine.length === 0
                    ? "Listings filed here appear in this client’s filters and reports."
                    : `${formatNumber(mine.length)} ${mine.length === 1 ? "listing belongs" : "listings belong"} to this client.`}
                </p>
                {mine.length > 0 ? (
                  <p className="text-caption text-ink-muted">
                    Unfiling or moving a listing keeps its Google link and
                    reviews.
                  </p>
                ) : null}
              </div>
              <Link
                href={`/setup?client=${clientId}&step=locations`}
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" })
                )}
              >
                <Link2Icon aria-hidden />
                Add listings from Google
              </Link>
            </div>

            {listingsError ? (
              <Alert variant="destructive">
                <AlertTitle>{listingsError.title}</AlertTitle>
                <AlertDescription>{listingsError.description}</AlertDescription>
              </Alert>
            ) : null}

            {directory.isPending ? (
              <Skeleton className="h-32 rounded-(--np-radius-card)" />
            ) : directory.isError ? (
              <Alert variant="destructive">
                <AlertTitle>We couldn’t load this client’s listings</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-2">
                  {describeActionError(directory.error)}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void directory.refetch()}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            ) : mine.length > 0 ? (
              <DataTable
                caption={`Listings filed under ${client.name}`}
                rows={mine}
                rowId={(location) => location.id}
                surface
                responsive
                columns={[
                  {
                    id: "name",
                    header: "Listing",
                    priority: "primary",
                    cell: (l) => (
                      <Link
                        href={`/listings/${l.id}`}
                        // The record card's way in: a full touch-height row
                        // on touch (the name alone is an 18px line), the
                        // compact text link at the desk.
                        className="inline-flex min-h-(--np-touch) items-center rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo hover:underline desk:min-h-0"
                      >
                        {l.name}
                      </Link>
                    ),
                  },
                  {
                    id: "address",
                    header: "Address",
                    priority: "secondary",
                    cell: (l) => (
                      <span className="text-caption break-words text-ink-muted">
                        {formatAddressLine(l.address) ?? "No address"}
                      </span>
                    ),
                  },
                  {
                    id: "linked",
                    header: "Google",
                    priority: "trailing",
                    cell: (l) =>
                      l.linked ? (
                        <StatusPill tone="healthy">Linked</StatusPill>
                      ) : (
                        <StatusPill tone="neutral" dashed>
                          Not linked
                        </StatusPill>
                      ),
                  },
                  {
                    id: "action",
                    header: <span className="sr-only">Actions</span>,
                    // Two buttons crowd a phone's title line, so on a card
                    // they take their own full-width row under the address.
                    priority: "detail",
                    span: true,
                    className: "text-right",
                    cell: (l) => (
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {others.length > 0 ? (
                          <MoveToClient
                            location={l}
                            clients={others}
                            disabled={busy !== null}
                            onMove={(target) => void move(l, target)}
                          />
                        ) : null}
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Unfile ${l.name}`}
                          pending={busy === l.id}
                          pendingLabel="Unfiling…"
                          disabled={busy !== null && busy !== l.id}
                          onClick={() => void remove(l)}
                        >
                          Unfile
                        </Button>
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <Card flush>
                <Empty
                  titleAs="h3"
                  icon={<MapPinIcon />}
                  title="No listings filed here"
                  description={
                    unassigned.length > 0
                      ? "Pick one from Unfiled listings below, or bring new ones in from Google."
                      : "There are no unfiled listings to add. Bring this client’s listings in from Google."
                  }
                />
              </Card>
            )}

            {unassigned.length > 0 ? (
              <div className="mt-2 flex flex-col gap-2">
                <h3 className="text-body font-semibold text-ink">
                  Unfiled listings
                </h3>
                <p className="text-caption text-ink-muted">
                  Imported from Google but not filed under any client. Select
                  the ones to file here. Teammates who already see every other
                  listing of {client.name} get access to the ones you add.
                </p>
                <div role="search" className="w-full min-w-0 sm:w-80">
                  <SearchInput
                    value={unfiledQuery}
                    onChange={(event) => setUnfiledQuery(event.target.value)}
                    placeholder="Filter by name or address"
                    aria-label="Filter unfiled listings by name or address"
                  />
                </div>
                <Card flush>
                  {unfiledShown.length === 0 ? (
                    <p className="px-3.5 py-4 text-ui text-ink-muted">
                      No unfiled listing matches “{unfiledQuery.trim()}”.
                    </p>
                  ) : (
                    // Below 48rem of its own width each row is a record
                    // card: the checkbox in its leading slot, the name as
                    // the headline with the Google state trailing, and the
                    // address as the subtitle (two branches of one chain
                    // share a name; the address tells them apart).
                    <DataTable
                      caption="Listings with no client, available to add"
                      rows={unfiledShown}
                      rowId={(location) => location.id}
                      responsive
                      selection={{
                        selected,
                        onChange: setSelected,
                        label: (location) => `Add ${location.name}`,
                      }}
                      columns={[
                        {
                          id: "name",
                          header: "Listing",
                          priority: "primary",
                          cell: (l) => (
                            <span className="font-semibold break-words text-ink">
                              {l.name}
                            </span>
                          ),
                        },
                        {
                          id: "address",
                          header: "Address",
                          priority: "secondary",
                          cell: (l) => (
                            <span className="text-caption break-words text-ink-muted">
                              {formatAddressLine(l.address) ?? "No address"}
                            </span>
                          ),
                        },
                        {
                          id: "linked",
                          header: "Google",
                          priority: "trailing",
                          cell: (l) =>
                            l.linked ? (
                              <StatusPill tone="healthy">Linked</StatusPill>
                            ) : (
                              <StatusPill tone="neutral" dashed>
                                Not linked
                              </StatusPill>
                            ),
                        },
                      ]}
                    />
                  )}
                </Card>
                {/* Docked to the bottom of a phone while the unfiled list is
                    on screen (the tab bar steps aside for it, and a spacer
                    keeps the list's last row reachable above it); inline
                    under the list on a desk. Only there while something is
                    picked. */}
                <ActionBar
                  dock
                  visible={selected.size > 0}
                  label="Unfiled listing actions"
                  className="desk:static"
                  status={`${formatNumber(selected.size)} selected`}
                  actions={
                    <>
                      <Button
                        variant="ghost-dark"
                        size="sm"
                        disabled={assignLocations.isPending}
                        onClick={() => setSelected(new Set())}
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        pending={assignLocations.isPending}
                        pendingLabel="Adding…"
                        onClick={() => {
                          if (selected.size > BULK_FILE_CONFIRM_THRESHOLD) {
                            setConfirmBulk(true)
                          } else {
                            void assign()
                          }
                        }}
                      >
                        Add {formatNumber(selected.size)} to this client
                      </Button>
                    </>
                  }
                />
                <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
                  <AlertDialogContent>
                    <AlertDialogTitle className="[overflow-wrap:anywhere]">
                      File {formatNumber(selected.size)} listings under{" "}
                      {client.name}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      They join {client.name}’s filters and reports, and
                      teammates who see every other listing of {client.name} get
                      access to them. You can remove any of them later.
                    </AlertDialogDescription>
                    <ul className="flex max-h-48 list-disc flex-col gap-1 overflow-y-auto pl-5 text-ui text-ink">
                      {unassigned
                        .filter((location) => selected.has(location.id))
                        .map((location) => (
                          <li key={location.id} className="break-words">
                            {location.name}
                          </li>
                        ))}
                    </ul>
                    <AlertDialogFooter>
                      <AlertDialogClose
                        render={<Button variant="ghost">Cancel</Button>}
                      />
                      <Button
                        pending={assignLocations.isPending}
                        pendingLabel="Adding…"
                        onClick={() => void assign()}
                      >
                        File {formatNumber(selected.size)} listings
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : directory.isSuccess && mine.length > 0 ? (
              // With nothing filed here either, the empty state above says it.
              <p className="text-caption text-ink-muted">
                Every imported listing is filed under a client.
              </p>
            ) : null}
          </section>

          <ArchiveSection
            client={client}
            attached={directory.isSuccess ? mine : null}
            listingsFailed={directory.isError}
            busy={update.isPending}
            onArchive={async (detach) => {
              try {
                await update.mutateAsync({
                  clientId,
                  archived: true,
                  ...(detach.length > 0 ? { detachLocations: true } : {}),
                })
              } catch (error) {
                // An older server answered `PATCH archived:true` with a
                // summary it no longer listed, so a successful archive could
                // arrive as an unparseable reply. Only a re-read decides: a
                // not-found now means it took.
                if (!(await archiveConfirmed(clientId))) throw error
                // The list only: this client's own query would now 404 and
                // flash an error state on the way out.
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.clients,
                })
              }
              // Undo runs once and closes this toast; the restore's own toast
              // then says how it went.
              toast.show({
                kind: "local",
                title: `${client.name} archived`,
                description:
                  detach.length > 0
                    ? `Its ${detach.length === 1 ? "listing is" : `${formatNumber(detach.length)} listings are`} now unfiled. Undo re-files ${detach.length === 1 ? "it" : "them"}; restoring later from Clients › Archived won’t.`
                    : "It’s hidden from lists and filters. Restore it from Clients › Archived.",
                undo: {
                  onUndo: () =>
                    void undoArchive(clientId, detach, client.name).then(
                      (message) => {
                        invalidate()
                        toast.show(message)
                      }
                    ),
                },
              })
              router.push("/clients")
            }}
          />
        </div>
      </div>
    </>
  )
}

/**
 * Restores an archived client and re-files the listings the archive unfiled.
 * Answers the toast to show, success or failure.
 */
async function undoArchive(
  clientId: string,
  detached: string[],
  name: string
): Promise<LocalToastOptions> {
  try {
    await updateClient(clientId, { archived: false })
  } catch (error) {
    return {
      type: "error",
      title: `${name} wasn’t restored`,
      description: `${describeActionError(error)} Restore it from Clients › Archived.`,
    }
  }
  // The restore is confirmed by now; a failed re-file must not read as if it
  // were not, so it gets its own answer.
  if (detached.length > 0) {
    try {
      await assignLocationsToClient(clientId, {
        locationIds: detached,
        grantToClientMembers: false,
      })
    } catch (error) {
      return {
        type: "error",
        title: `${name} is restored, but its listings weren’t filed back`,
        description: `${describeActionError(error)} File them again from ${name}’s settings, under Listings.`,
      }
    }
  }
  return { type: "success", title: `${name} restored` }
}

/**
 * Whether the client is now archived, read back from the server: the client
 * endpoint answers `client_not_found` for an archived client. Any other
 * answer (still there, or the re-read itself failed) is not evidence.
 */
async function archiveConfirmed(clientId: string): Promise<boolean> {
  try {
    await fetchClient(clientId)
    return false
  } catch (error) {
    return isClientNotFound(error)
  }
}

/** The client endpoint's answer for an archived, missing or hidden client. */
function isClientNotFound(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 404 &&
    error.code === "client_not_found"
  )
}

/** "Move to…" another client, from a filed listing's row. */
function MoveToClient({
  location,
  clients,
  disabled,
  onMove,
}: {
  location: DirectoryEntry
  clients: ClientSummary[]
  disabled: boolean
  onMove: (target: ClientSummary) => void
}) {
  return (
    <Select
      value={null}
      disabled={disabled}
      onValueChange={(next: string | null) => {
        const target = clients.find((entry) => entry.id === next)
        if (target) onMove(target)
      }}
    >
      <SelectTrigger
        className="h-(--np-control-h-sm) w-36 text-ui pointer-coarse:min-h-(--np-touch)"
        aria-label={`Move ${location.name} to another client`}
      >
        <SelectValue>{() => "Move to…"}</SelectValue>
      </SelectTrigger>
      <SelectContent title="Move to another client">
        {clients.map((entry) => (
          <SelectItem key={entry.id} value={entry.id}>
            {entry.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ArchiveSection({
  client,
  attached,
  listingsFailed,
  busy,
  onArchive,
}: {
  client: ClientResponse["client"]
  /** Listings still filed here; null until the directory has loaded. */
  attached: DirectoryEntry[] | null
  /** The directory didn't load, so what archiving would unfile is unknown. */
  listingsFailed: boolean
  /** Another write to this client (a details save) is on its way. */
  busy: boolean
  /** Archives, unfiling these listings first when there are any. */
  onArchive: (detach: string[]) => Promise<void>
}) {
  const [error, setError] = React.useState<string | null>(null)
  // Its own, not the shared update mutation's: a details save must not
  // relabel this button "Archiving…".
  const [archiving, setArchiving] = React.useState(false)

  const archive = async () => {
    setError(null)
    setArchiving(true)
    try {
      await onArchive((attached ?? []).map((entry) => entry.id))
    } catch (cause) {
      setError(describeActionError(cause))
    } finally {
      setArchiving(false)
    }
  }

  return (
    <section
      id="archive"
      aria-labelledby="client-archive"
      className="scroll-mt-20"
    >
      <Card className="border-danger-ink">
        <CardHeader>
          <CardTitle as="h2" id="client-archive">
            Archive
          </CardTitle>
          <CardDescription>
            Archiving hides the client from lists and filters. Its listings’
            review history is kept. Undo, straight after, restores the client
            and re-files its listings; restoring it later from Clients ›
            Archived brings back the client only.
          </CardDescription>
        </CardHeader>
        {/* The shared action closes a page, so it opens with a gap and
            centres itself; inside this card it sits flush under the
            description, on the card's left edge. */}
        <CardContent className="flex flex-col gap-3 [&>[data-slot=settings-destructive]]:mt-0 [&>[data-slot=settings-destructive]]:items-start [&>[data-slot=settings-destructive]]:justify-start [&>[data-slot=settings-destructive]]:text-start">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{client.name} wasn’t archived</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {/* One step: archiving is reversible, so it acts at once and the
              toast carries the Undo. */}
          <SettingsDestructiveAction
            // A long client name wraps instead of pushing the card wider;
            // the negative start margin lines its label up with the text.
            className="-ms-4 h-auto justify-start py-2 text-start [overflow-wrap:anywhere]"
            disabled={attached === null || busy || archiving}
            onClick={() => void archive()}
            footnote={
              attached === null ? (
                listingsFailed ? (
                  "We couldn’t check its listings, so it can’t be archived yet. Try again under Listings above."
                ) : (
                  "Checking attached listings…"
                )
              ) : attached.length > 0 ? (
                <>
                  {client.name} still has{" "}
                  {attached.length === 1
                    ? "its listing"
                    : `its ${formatNumber(attached.length)} listings`}
                  . Archiving unfiles {attached.length === 1 ? "it" : "them"},
                  so no listing is left under a hidden client. They stay linked
                  to Google and keep their reviews.
                </>
              ) : (
                `No listings are attached, so ${client.name} can be archived.`
              )
            }
          >
            {archiving ? "Archiving…" : `Archive ${client.name}`}
          </SettingsDestructiveAction>
        </CardContent>
      </Card>
    </section>
  )
}

type DetailsDraft = { name: string; notes: string; colour: string | null }

/** A stashed details draft, or null when malformed or no different from `client`. */
function parseDetailsDraft(
  value: unknown,
  client: ClientResponse["client"]
): DetailsDraft | null {
  if (typeof value !== "object" || value === null) return null
  const { name, notes, colour } = value as Record<string, unknown>
  if (typeof name !== "string" || typeof notes !== "string") return null
  if (colour !== null && typeof colour !== "string") return null
  const changed =
    name.trim() !== client.name ||
    notes.trim() !== (client.notes ?? "") ||
    colour !== (client.colour ?? null)
  return changed ? { name, notes, colour } : null
}

function ClientDetailsForm({
  client,
  onSave,
}: {
  client: ClientResponse["client"]
  onSave: (input: ClientDetails) => Promise<void>
}) {
  const [name, setName] = React.useState(client.name)
  const [notes, setNotes] = React.useState(client.notes ?? "")
  const [colour, setColour] = React.useState<string | null>(client.colour)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const nameRef = React.useRef<HTMLInputElement>(null)
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  const dirty =
    name.trim() !== client.name ||
    notes.trim() !== (client.notes ?? "") ||
    (colour ?? null) !== (client.colour ?? null)
  // The bar, and the Save or Discard button that had focus, goes with the
  // last unsaved change. Focus that fell to the page body comes back to the
  // Details heading: not the name field, which would raise a phone keyboard.
  const keepFocus = () =>
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (active && active !== document.body) return
      titleRef.current?.focus({ preventScroll: true })
    })
  const discard = () => {
    setName(client.name)
    setNotes(client.notes ?? "")
    setColour(client.colour)
    setNameError(null)
    setSaveError(null)
    keepFocus()
  }

  // Warns on a tab close or reload while edits are unsaved, and keeps them
  // through a forced sign-out, offering them back on the next visit; the
  // page's Back link, any other in-app link and the back button ask first.
  const draftKey = useDraftKey({
    resource: "client-details",
    resourceId: client.id,
    schemaVersion: 1,
  })
  const unsaved = useUnsavedChanges<DetailsDraft>({
    scope: draftKey,
    isDirty: dirty && !pending,
    restore: {
      snapshot: () => ({ name, notes, colour }),
      parse: (value) => parseDetailsDraft(value, client),
    },
  })

  return (
    <form
      id="details"
      noValidate
      aria-labelledby="client-details-title"
      className="scroll-mt-20"
      onSubmit={async (event) => {
        event.preventDefault()
        setSaveError(null)
        if (!name.trim()) {
          setNameError("Give the client a name.")
          nameRef.current?.focus()
          return
        }
        setPending(true)
        try {
          // Values stay in the form when the save fails.
          await onSave({
            name: name.trim(),
            notes: notes.trim() || null,
            colour,
          })
          keepFocus()
        } catch (error) {
          setSaveError(describeActionError(error))
        } finally {
          setPending(false)
        }
      }}
    >
      <Card flush>
        <CardHeader divided>
          <CardTitle
            as="h2"
            id="client-details-title"
            ref={titleRef}
            // A focus target once the save bar goes, never a Tab stop.
            tabIndex={-1}
            className="focus-visible:outline-none"
          >
            Details
          </CardTitle>
          <CardDescription>
            How your team refers to this client. Google listing names aren’t
            changed.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-5 p-(--np-card-pad)">
          {unsaved.stashed ? (
            <StashedEditsNotice
              noun="this client’s details"
              onRestore={() => {
                const restored = unsaved.restoreStashed()
                if (!restored) return
                setName(restored.name)
                setNotes(restored.notes)
                setColour(restored.colour)
              }}
              onDismiss={unsaved.dismissStashed}
            />
          ) : null}
          <Field error={nameError ?? undefined}>
            <FieldLabel>Client name</FieldLabel>
            <Input
              ref={nameRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (nameError && event.target.value.trim()) setNameError(null)
              }}
              maxLength={120}
              autoComplete="off"
              required
            />
            <FieldError />
          </Field>
          <ClientColourField value={colour} onChange={setColour} name={name} />
          <Field>
            <FieldLabel optional>Notes</FieldLabel>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              maxLength={NOTES_MAX}
              placeholder="Anything your team should know before replying for this client."
            />
            <FieldCounter count={notes.length} max={NOTES_MAX}>
              {formatNumber(notes.length)} / {formatNumber(NOTES_MAX)}
            </FieldCounter>
          </Field>
          {saveError ? (
            <Alert variant="destructive">
              <AlertTitle>Changes not saved</AlertTitle>
              <AlertDescription>
                {saveError} Your edits are still here.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </Card>
      {/* Only once there is something to save. Docked to a phone's bottom
          edge (the tab bar steps aside and the bar rides the keyboard);
          stuck to the foot of the form on a desk. */}
      <ActionBar
        dock
        tone="surface"
        visible={dirty}
        offset="md:bottom-3"
        label="Save client details"
        status={
          <>
            <PenLineIcon aria-hidden />
            <span>{pending ? "Saving…" : "Unsaved changes"}</span>
          </>
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={discard}
            >
              Discard
            </Button>
            <Button type="submit" pending={pending} pendingLabel="Saving…">
              Save changes
            </Button>
          </>
        }
      />
      <DiscardDialog
        {...unsaved.leavePrompt}
        title="Leave without saving?"
        confirmLabel="Leave and discard"
        announce={false}
        description="Your changes to this client’s details aren’t saved. Leaving throws them away."
      />
    </form>
  )
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p role="status" className="text-ui text-ink-muted">
        Loading this client’s settings…
      </p>
      <Card>
        <CardContent className="flex flex-col gap-3.5">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-9" />
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-3.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-5" />
          <Skeleton className="h-5" />
        </CardContent>
      </Card>
    </div>
  )
}

export { ClientSettings }
