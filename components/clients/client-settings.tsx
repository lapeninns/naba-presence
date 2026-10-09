"use client"

import {
  ArchiveIcon,
  CircleAlertIcon,
  Link2Icon,
  MapPinIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { ClientColourField } from "@/components/clients/client-colour-field"
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
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import {
  assignLocationsToClient,
  fetchClient,
  updateClient,
} from "@/lib/api/clients"
import type { ClientResponse, ClientSummary } from "@/lib/contracts/clients"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
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
 * the listings tables and the Archive danger card; the rail becomes a row of
 * links on a narrow screen.
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
    return (
      <>
        <SettingsHeader clientId={clientId} name={null} />
        <div className="rounded-(--np-radius-card) border border-line bg-surface">
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
        </div>
      </>
    )
  }

  return <SettingsBody clientId={clientId} client={query.data.client} />
}

function SettingsHeader({
  clientId,
  name,
  confirmLeave,
}: {
  clientId: string
  name: string | null
  /** Asks before leaving with unsaved details; resolves true to go. */
  confirmLeave?: () => Promise<boolean>
}) {
  const router = useRouter()
  const href = `/clients/${clientId}`
  return (
    <PageHeader
      title="Client settings"
      eyebrow={name ?? "Client"}
      description="Rename the client, file its listings, or archive it."
      actions={
        <Link
          href={href}
          className={cn(buttonVariants({ variant: "secondary" }))}
          onClick={
            confirmLeave
              ? (event) => {
                  // A modified click opens a new tab and leaves this one,
                  // edits included, where it is.
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return
                  event.preventDefault()
                  void confirmLeave().then((go) => {
                    if (go) router.push(href)
                  })
                }
              : undefined
          }
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
  const toast = useToastManager()
  const router = useRouter()
  const queryClient = useQueryClient()
  const leaveGuard = React.useRef<(() => Promise<boolean>) | null>(null)

  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState<string | null>(null)
  const [listingsError, setListingsError] = React.useState<string | null>(null)
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

  /** Put listings back under a client, for an Undo. Grants were never removed. */
  const refile = async (
    targetClientId: string,
    locationIds: string[],
    done: string
  ) => {
    try {
      await assignLocationsToClient(targetClientId, {
        locationIds,
        grantToClientMembers: false,
      })
      invalidate()
      toast.add({ type: "success", title: done })
    } catch (error) {
      toast.add({
        type: "error",
        title: "That couldn’t be undone",
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
      toast.add({
        type: "success",
        title: `${location.name} is now unfiled`,
        description: "Its reviews and Google link are unchanged.",
        actionProps: {
          children: "Undo",
          onClick: () =>
            void refile(
              clientId,
              [location.id],
              `${location.name} is back under ${client.name}`
            ),
        },
      })
    } catch (error) {
      setListingsError(describeActionError(error))
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
      toast.add({
        type: "success",
        title: `${location.name} moved to ${target.name}`,
        actionProps: {
          children: "Undo",
          onClick: () =>
            void refile(
              clientId,
              [location.id],
              `${location.name} is back under ${client.name}`
            ),
        },
      })
    } catch (error) {
      setListingsError(describeActionError(error))
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
      toast.add({
        type: "success",
        title:
          ids.length === 1
            ? `1 listing filed under ${client.name}`
            : `${formatNumber(ids.length)} listings filed under ${client.name}`,
      })
      setSelected(new Set())
    } catch (error) {
      setListingsError(describeActionError(error))
    }
  }

  return (
    <>
      <SettingsHeader
        clientId={clientId}
        name={client.name}
        confirmLeave={() => leaveGuard.current?.() ?? Promise.resolve(true)}
      />
      <div className="grid items-start gap-6 @min-[760px]:grid-cols-[minmax(11rem,13.75rem)_minmax(0,1fr)]">
        <nav
          aria-label="Client settings sections"
          className="flex flex-wrap gap-1 @min-[760px]:sticky @min-[760px]:top-[calc(var(--np-toolbar-h)+16px)] @min-[760px]:flex-col @min-[760px]:gap-0.5"
        >
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="flex min-h-[34px] items-center rounded-(--np-radius-control) px-2.5 text-ui text-ink-secondary no-underline focus-halo hover:bg-fill pointer-coarse:min-h-(--np-touch)"
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <ClientDetailsForm
            client={client}
            registerGuard={(guard) => {
              leaveGuard.current = guard
            }}
            onSave={async (input) => {
              await update.mutateAsync({ clientId, ...input })
              toast.add({ type: "success", title: "Client updated" })
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
                    ? "No listings are filed under this client yet."
                    : `${formatNumber(mine.length)} ${mine.length === 1 ? "listing belongs" : "listings belong"} to this client.`}
                </p>
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
                <AlertTitle>That didn’t save</AlertTitle>
                <AlertDescription>{listingsError}</AlertDescription>
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
                    span: true,
                    label: "",
                    cell: (l) => (
                      <span className="flex min-w-0 flex-col">
                        <Link
                          href={`/listings/${l.id}`}
                          className="rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo hover:underline"
                        >
                          {l.name}
                        </Link>
                        {formatAddressLine(l.address) ? (
                          <span className="text-caption break-words text-ink-muted">
                            {formatAddressLine(l.address)}
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    id: "linked",
                    header: "Google",
                    cell: (l) =>
                      l.linked ? (
                        <StatusPill tone="ok">Linked</StatusPill>
                      ) : (
                        <StatusPill tone="neutral" dashed>
                          Not linked
                        </StatusPill>
                      ),
                  },
                  {
                    id: "action",
                    header: <span className="sr-only">Actions</span>,
                    label: "",
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
                          aria-label={`Remove ${l.name} from this client`}
                          pending={busy === l.id}
                          pendingLabel="Working…"
                          disabled={busy !== null && busy !== l.id}
                          onClick={() => void remove(l)}
                        >
                          Remove
                        </Button>
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <div className="rounded-(--np-radius-card) border border-line bg-surface">
                <Empty
                  titleAs="h3"
                  icon={<MapPinIcon />}
                  title="No listings filed here"
                  description="Add one from the unfiled list below, or bring new ones in from Google."
                />
              </div>
            )}

            {unassigned.length > 0 ? (
              <div className="mt-2 flex flex-col gap-2">
                <h3 className="text-body font-semibold text-ink">
                  Unfiled listings
                </h3>
                <p className="text-caption text-ink-muted">
                  Imported from Google but not filed under any client. Teammates
                  who already see every other listing of {client.name} get
                  access to the ones you add.
                </p>
                <div role="search" className="w-full min-w-0 sm:w-80">
                  <SearchInput
                    value={unfiledQuery}
                    onChange={(event) => setUnfiledQuery(event.target.value)}
                    placeholder="Filter by name or address"
                    aria-label="Filter unfiled listings by name or address"
                  />
                </div>
                <div className="flex flex-col overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
                  {unfiledShown.length === 0 ? (
                    <p className="px-3.5 py-4 text-ui text-ink-muted">
                      No unfiled listing matches “{unfiledQuery.trim()}”.
                    </p>
                  ) : (
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
                          cell: (l) => (
                            <span className="font-semibold break-words text-ink">
                              {l.name}
                            </span>
                          ),
                        },
                        {
                          // Two branches of one chain share a name; the
                          // address is how they are told apart.
                          id: "address",
                          header: "Address",
                          cell: (l) => (
                            <span className="text-ui break-words text-ink-muted">
                              {formatAddressLine(l.address) ?? "—"}
                            </span>
                          ),
                        },
                        {
                          id: "linked",
                          header: "Google",
                          cell: (l) =>
                            l.linked ? (
                              <StatusPill tone="ok">Linked</StatusPill>
                            ) : (
                              <StatusPill tone="neutral" dashed>
                                Not linked
                              </StatusPill>
                            ),
                        },
                      ]}
                    />
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-alt px-3.5 py-2.5">
                    <span
                      className="text-caption text-ink-muted"
                      aria-live="polite"
                    >
                      {selected.size > 0
                        ? `${formatNumber(selected.size)} selected`
                        : "Select listings to file under this client"}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={selected.size === 0}
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
                      {selected.size === 0
                        ? "Add to this client"
                        : `Add ${formatNumber(selected.size)} to this client`}
                    </Button>
                  </div>
                </div>
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
            ) : directory.isSuccess ? (
              <p className="text-caption text-ink-muted">
                Every imported listing is filed under a client.
              </p>
            ) : null}
          </section>

          <ArchiveSection
            client={client}
            attached={directory.isSuccess ? mine : null}
            pending={update.isPending}
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
              toast.add({
                type: "success",
                title: `${client.name} archived`,
                description:
                  detach.length > 0
                    ? `Its ${detach.length === 1 ? "listing is" : `${formatNumber(detach.length)} listings are`} now unfiled. Restore it from Clients › Archived.`
                    : "It’s hidden from lists and filters. Restore it from Clients › Archived.",
                actionProps: {
                  children: "Undo",
                  onClick: () =>
                    void undoArchive(clientId, detach, client.name).then(
                      (message) => {
                        invalidate()
                        toast.add(message)
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
): Promise<{ type: string; title: string; description?: string }> {
  try {
    await updateClient(clientId, { archived: false })
    if (detached.length > 0) {
      await assignLocationsToClient(clientId, {
        locationIds: detached,
        grantToClientMembers: false,
      })
    }
    return { type: "success", title: `${name} restored` }
  } catch (error) {
    return {
      type: "error",
      title: `${name} wasn’t restored`,
      description: `${describeActionError(error)} Restore it from Clients › Archived.`,
    }
  }
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
    return (
      error instanceof ApiClientError &&
      error.status === 404 &&
      error.code === "client_not_found"
    )
  }
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
        className="h-[30px] w-36 text-[12.5px] pointer-coarse:min-h-(--np-touch)"
        aria-label={`Move ${location.name} to another client`}
      >
        <SelectValue>{() => "Move to…"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
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
  pending,
  onArchive,
}: {
  client: ClientResponse["client"]
  /** Listings still filed here; null while the directory loads. */
  attached: DirectoryEntry[] | null
  pending: boolean
  /** Archives, unfiling these listings first when there are any. */
  onArchive: (detach: string[]) => Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const loading = attached === null
  const count = attached?.length ?? 0
  const listingsPhrase =
    count === 1 ? "its listing" : `its ${formatNumber(count)} listings`

  return (
    <section
      id="archive"
      aria-labelledby="client-archive"
      className="flex scroll-mt-20 flex-col gap-3 rounded-(--np-radius-card) border border-danger-ink bg-surface p-(--np-card-pad)"
    >
      <div className="flex flex-col gap-1">
        <h2 id="client-archive" className="text-title font-semibold text-ink">
          Archive
        </h2>
        <p className="text-ui text-ink-muted">
          Archiving hides the client from lists and filters. Its listings’
          review history is kept, and you can restore it from Clients ›
          Archived.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          id="client-archive-reason"
          className="min-w-0 flex-[1_1_16rem] text-ui"
        >
          {loading ? (
            <span className="text-ink-muted">Checking attached listings…</span>
          ) : count > 0 ? (
            <span className="text-ink-muted">
              {client.name} still has {listingsPhrase}. Archiving unfiles{" "}
              {count === 1 ? "it" : "them"}, so no listing is left under a
              hidden client.
            </span>
          ) : (
            <span className="text-ink-muted">
              No listings are attached, so {client.name} can be archived.
            </span>
          )}
        </p>
        <Button
          variant="danger-outline"
          // A long client name wraps instead of pushing the card wider.
          className="h-auto min-h-(--np-control-h) max-w-full py-2 text-left leading-5 [overflow-wrap:anywhere] whitespace-normal"
          disabled={loading}
          focusableWhenDisabled={loading}
          aria-describedby="client-archive-reason"
          onClick={() => {
            setAcknowledged(false)
            setError(null)
            setOpen(true)
          }}
        >
          <ArchiveIcon aria-hidden />
          Archive {client.name}
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">
            Archive {client.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {count > 0
              ? `${client.name} still has ${count === 1 ? "1 listing" : `${formatNumber(count)} listings`}.`
              : `${client.name} has no listings attached.`}
          </AlertDialogDescription>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-ui text-ink">
            <li>It disappears from the Clients list, filters and reports.</li>
            {count > 0 ? (
              <li>
                {count === 1 ? "Its listing becomes" : "Its listings become"}{" "}
                unfiled. They stay linked to Google and keep their reviews.
              </li>
            ) : null}
            <li>Its notes and review history are kept.</li>
            <li>You can restore it from Clients › Archived.</li>
          </ul>
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(Boolean(checked))}
            label="I understand this client will be hidden from my team."
          />
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{client.name} wasn’t archived</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Keep the client</Button>}
            />
            <Button
              variant="danger"
              className="h-auto min-h-(--np-control-h) max-w-full py-2 text-left leading-5 [overflow-wrap:anywhere] whitespace-normal"
              disabled={!acknowledged}
              pending={pending}
              pendingLabel="Archiving…"
              onClick={async () => {
                setError(null)
                try {
                  await onArchive((attached ?? []).map((entry) => entry.id))
                  setOpen(false)
                } catch (cause) {
                  setError(describeActionError(cause))
                }
              }}
            >
              {count > 0
                ? `Unfile ${count === 1 ? "its listing" : `its ${formatNumber(count)} listings`} and archive`
                : `Archive ${client.name}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function ClientDetailsForm({
  client,
  onSave,
  registerGuard,
}: {
  client: ClientResponse["client"]
  onSave: (input: ClientDetails) => Promise<void>
  /** Hands the page a way to ask before leaving with unsaved edits. */
  registerGuard: (guard: () => Promise<boolean>) => void
}) {
  const [name, setName] = React.useState(client.name)
  const [notes, setNotes] = React.useState(client.notes ?? "")
  const [colour, setColour] = React.useState<string | null>(client.colour)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const nameRef = React.useRef<HTMLInputElement>(null)
  const dirty =
    name.trim() !== client.name ||
    notes.trim() !== (client.notes ?? "") ||
    (colour ?? null) !== (client.colour ?? null)

  // Warns on a tab close or reload while edits are unsaved, and keeps them
  // through a forced sign-out; the page's Back link asks through it too.
  const { confirmDiscard } = useDirtyGuard({
    key: `client-details:${client.id}`,
    isDirty: dirty && !pending,
    snapshot: () => JSON.stringify({ name, notes, colour }),
    askConfirm: async () =>
      window.confirm(
        "You have unsaved changes to this client’s details. Leave without saving?"
      ),
  })
  React.useEffect(() => {
    registerGuard(confirmDiscard)
  }, [registerGuard, confirmDiscard])

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
        } catch (error) {
          setSaveError(describeActionError(error))
        } finally {
          setPending(false)
        }
      }}
    >
      <Card flush>
        <CardHeader divided>
          <CardTitle as="h2" id="client-details-title">
            Details
          </CardTitle>
          <CardDescription>
            How your team refers to this client. Google listing names aren’t
            changed.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-5 p-(--np-card-pad)">
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
          <ClientColourField value={colour} onChange={setColour} />
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
        <CardFooter bar>
          <span role="status" className="text-caption text-ink-muted">
            {dirty ? "Unsaved changes" : "No unsaved changes"}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={!dirty || pending}
              onClick={() => {
                setName(client.name)
                setNotes(client.notes ?? "")
                setColour(client.colour)
                setNameError(null)
                setSaveError(null)
              }}
            >
              Discard
            </Button>
            <Button
              type="submit"
              disabled={!dirty}
              pending={pending}
              pendingLabel="Saving…"
            >
              Save changes
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  )
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p role="status" className="text-ui text-ink-muted">
        Loading this client’s settings…
      </p>
      <div className="flex flex-col gap-3.5 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-9" />
        <Skeleton className="h-24" />
      </div>
      <div className="flex flex-col gap-3.5 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-5" />
        <Skeleton className="h-5" />
      </div>
    </div>
  )
}

export { ClientSettings }
