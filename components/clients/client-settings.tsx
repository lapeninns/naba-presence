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
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import { fetchClient } from "@/lib/api/clients"
import type { ClientResponse } from "@/lib/contracts/clients"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import { useClient, useClientMutations } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

const NOTES_MAX = 2000

const SECTIONS = [
  { id: "details", label: "Details" },
  { id: "listings", label: "Listings" },
  { id: "archive", label: "Archive" },
]

/**
 * Renaming, notes, which listings belong here, and archiving.
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
}: {
  clientId: string
  name: string | null
}) {
  return (
    <PageHeader
      title="Client settings"
      eyebrow={name ?? "Client"}
      description="Rename the client, file its listings, or archive it."
      actions={
        <Link
          href={`/clients/${clientId}`}
          className={cn(buttonVariants({ variant: "secondary" }))}
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
  const { update, assignLocations, unassignLocations } = useClientMutations()
  const toast = useToastManager()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [listingsError, setListingsError] = React.useState<string | null>(null)

  const unassigned = (directory.data ?? []).filter(
    (location) => !location.clientId
  )
  const mine = (directory.data ?? []).filter(
    (location) => location.clientId === clientId
  )

  const remove = async (location: { id: string; name: string }) => {
    setRemoving(location.id)
    setListingsError(null)
    try {
      await unassignLocations.mutateAsync({
        clientId,
        locationIds: [location.id],
      })
      toast.add({
        title: `${location.name} is now unfiled`,
        description: "Its reviews and Google link are unchanged.",
      })
    } catch (error) {
      setListingsError(describeActionError(error))
    } finally {
      setRemoving(null)
    }
  }

  const assign = async () => {
    setListingsError(null)
    try {
      await assignLocations.mutateAsync({
        clientId,
        locationIds: [...selected],
      })
      toast.add({
        title:
          selected.size === 1
            ? `1 listing filed under ${client.name}`
            : `${selected.size} listings filed under ${client.name}`,
      })
      setSelected(new Set())
    } catch (error) {
      setListingsError(describeActionError(error))
    }
  }

  return (
    <>
      <SettingsHeader clientId={clientId} name={client.name} />
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
            onSave={async (input) => {
              await update.mutateAsync({ clientId, ...input })
              toast.add({ title: "Client updated" })
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
                      <Link
                        href={`/listings/${l.id}`}
                        className="rounded-(--np-radius-tag) font-semibold break-words text-ink underline-offset-4 focus-halo hover:underline"
                      >
                        {l.name}
                      </Link>
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
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Remove ${l.name} from this client`}
                        pending={removing === l.id}
                        pendingLabel="Removing…"
                        disabled={removing !== null && removing !== l.id}
                        onClick={() => void remove(l)}
                      >
                        Remove
                      </Button>
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
                <div className="flex flex-col overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
                  <DataTable
                    caption="Listings with no client, available to add"
                    rows={unassigned}
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
                      onClick={() => void assign()}
                    >
                      {selected.size === 0
                        ? "Add to this client"
                        : `Add ${formatNumber(selected.size)} to this client`}
                    </Button>
                  </div>
                </div>
              </div>
            ) : directory.isSuccess ? (
              <p className="text-caption text-ink-muted">
                Every imported listing is filed under a client.
              </p>
            ) : null}
          </section>

          <ArchiveSection
            client={client}
            attached={directory.isSuccess ? mine.length : null}
            pending={update.isPending}
            onArchive={async () => {
              try {
                await update.mutateAsync({ clientId, archived: true })
              } catch (error) {
                // `PATCH archived:true` answers with the client's summary,
                // which the server no longer lists once it is archived, so a
                // successful archive can arrive as an unparseable reply.
                // Only a re-read decides: a not-found now means it took.
                if (!(await archiveConfirmed(clientId))) throw error
                // The list only: this client's own query would now 404 and
                // flash an error state on the way out.
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.clients,
                })
              }
              toast.add({
                title: `${client.name} archived`,
                description: "It’s hidden from lists and filters.",
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

function ArchiveSection({
  client,
  attached,
  pending,
  onArchive,
}: {
  client: ClientResponse["client"]
  /** Listings still filed here; null while the directory loads. */
  attached: number | null
  pending: boolean
  onArchive: () => Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const blocked = attached === null || attached > 0

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
          review history is kept.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          id="client-archive-reason"
          className="min-w-0 flex-[1_1_16rem] text-ui"
        >
          {attached === null ? (
            <span className="text-ink-muted">Checking attached listings…</span>
          ) : attached > 0 ? (
            <>
              <span className="font-semibold text-warning-ink">
                Archiving is blocked while listings are attached.
              </span>{" "}
              <span className="text-ink-muted">
                Remove{" "}
                {attached === 1
                  ? "its listing"
                  : `its ${formatNumber(attached)} listings`}{" "}
                above first, so no listing is left without a client.
              </span>
            </>
          ) : (
            <span className="text-ink-muted">
              No listings are attached, so {client.name} can be archived.
            </span>
          )}
        </p>
        <Button
          variant="danger-outline"
          // A long client name wraps instead of pushing the card wider.
          className="h-auto min-h-(--np-control-h) max-w-full py-2 text-left leading-5 whitespace-normal [overflow-wrap:anywhere]"
          disabled={blocked}
          focusableWhenDisabled={blocked}
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
            {client.name} has no listings attached.
          </AlertDialogDescription>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-ui text-ink">
            <li>It disappears from the Clients list, filters and reports.</li>
            <li>Its notes and review history are kept.</li>
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
              className="h-auto min-h-(--np-control-h) max-w-full py-2 text-left leading-5 whitespace-normal [overflow-wrap:anywhere]"
              disabled={!acknowledged}
              pending={pending}
              pendingLabel="Archiving…"
              onClick={async () => {
                setError(null)
                try {
                  await onArchive()
                  setOpen(false)
                } catch (cause) {
                  // The server refuses while listings are attached; say what
                  // to do rather than failing silently.
                  setError(describeActionError(cause))
                }
              }}
            >
              Archive {client.name}
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
}: {
  client: ClientResponse["client"]
  onSave: (input: { name: string; notes: string | null }) => Promise<void>
}) {
  const [name, setName] = React.useState(client.name)
  const [notes, setNotes] = React.useState(client.notes ?? "")
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const nameRef = React.useRef<HTMLInputElement>(null)
  const dirty =
    name.trim() !== client.name || notes.trim() !== (client.notes ?? "")

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
          await onSave({ name: name.trim(), notes: notes.trim() || null })
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
          <Field>
            <FieldLabel optional>Notes</FieldLabel>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              maxLength={NOTES_MAX}
              placeholder="Anything your team should know before replying for this client."
            />
            <FieldCounter>
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
