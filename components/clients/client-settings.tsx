"use client"

import { ArchiveIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, FieldLabel } from "@/components/ui/field"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { Input } from "@/components/ui/input"
import { QueryStates } from "@/components/ui/query-states"
import { StatusPill } from "@/components/ui/status-pill"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { describeActionError } from "@/lib/errors/action-errors"
import type { ClientResponse } from "@/lib/contracts/clients"
import { formatNumber } from "@/lib/format"
import { useClient, useClientMutations } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

/**
 * Renaming, notes, which locations belong here, and archiving.
 *
 * Location assignment is the interesting half: locations arrive from Google
 * unassigned, and this is where they get filed. Assigning also extends access
 * to teammates who already hold every other location of the client, because a
 * colleague who can see four of a client's five venues but not the fifth is a
 * support ticket, not a security boundary.
 */
function ClientSettings({ clientId }: { clientId: string }) {
  const query = useClient(clientId)
  const role = useSessionRole()
  const directory = useLocationDirectory(role)
  const { update, assignLocations, unassignLocations } = useClientMutations()
  const toast = useToastManager()
  const router = useRouter()

  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  return (
    <QueryStates
      status={query.isPending ? "pending" : query.isError ? "error" : "ready"}
      error="We couldn't load this client"
      onRetry={() => void query.refetch()}
    >
      {() => {
        const { client } = query.data as ClientResponse
        const unassigned = (directory.data ?? []).filter(
          (location) => !location.clientId
        )
        const mine = (directory.data ?? []).filter(
          (location) => location.clientId === clientId
        )

        const archive = async () => {
          try {
            await update.mutateAsync({ clientId, archived: true })
            router.push("/clients")
          } catch (error) {
            // The server refuses while locations are attached; say what to
            // do rather than failing silently.
            toast.add({
              title: "Cannot archive yet",
              description: describeActionError(error),
            })
          }
        }

        return (
          <div className="flex flex-col gap-(--np-gap-section)">
            <ClientDetailsForm
              client={client}
              onSave={async (input) => {
                await update.mutateAsync({ clientId, ...input })
                toast.add({ title: "Client updated" })
              }}
              pending={update.isPending}
              error={update.error ? describeActionError(update.error) : null}
            />

            <section
              aria-labelledby="client-locations-settings"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-0.5">
                <h2
                  id="client-locations-settings"
                  className="text-title font-semibold text-ink"
                >
                  Locations
                </h2>
                <p className="text-caption text-ink-muted">
                  {mine.length === 0
                    ? "No locations are filed under this client yet."
                    : `${formatNumber(mine.length)} location${mine.length === 1 ? "" : "s"} belong to this client.`}
                </p>
              </div>

              {mine.length > 0 ? (
                <DataTable
                  caption="Locations currently assigned to this client"
                  rows={mine}
                  rowId={(location) => location.id}
                  density="compact"
                  surface
                  columns={[
                    {
                      id: "name",
                      header: "Location",
                      cell: (l) => (
                        <span className="font-medium text-ink">{l.name}</span>
                      ),
                    },
                    {
                      id: "linked",
                      header: "Google",
                      cell: (l) => (
                        <StatusPill
                          variant="inline"
                          tone={l.linked ? "healthy" : "neutral"}
                        >
                          {l.linked ? "Linked" : "Not linked"}
                        </StatusPill>
                      ),
                    },
                    {
                      id: "action",
                      header: <span className="sr-only">Actions</span>,
                      className: "text-right",
                      cell: (l) => (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await unassignLocations.mutateAsync({
                              clientId,
                              locationIds: [l.id],
                            })
                            toast.add({ title: `${l.name} is now unassigned` })
                          }}
                        >
                          Remove
                        </Button>
                      ),
                    },
                  ]}
                />
              ) : null}

              {unassigned.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Unassigned locations</CardTitle>
                    <CardDescription>
                      Imported from Google but not yet filed under a client.
                      Teammates who already hold every other location of this
                      client will get access to the ones you add.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-0">
                    <DataTable
                      caption="Locations with no client, available to assign"
                      rows={unassigned}
                      rowId={(location) => location.id}
                      density="compact"
                      selection={{
                        selected,
                        onChange: setSelected,
                        label: (location) => `Assign ${location.name}`,
                      }}
                      columns={[
                        {
                          id: "name",
                          header: "Location",
                          cell: (l) => (
                            <span className="font-medium text-ink">
                              {l.name}
                            </span>
                          ),
                        },
                        {
                          id: "linked",
                          header: "Google",
                          cell: (l) => (
                            <StatusPill
                              variant="inline"
                              tone={l.linked ? "healthy" : "neutral"}
                            >
                              {l.linked ? "Linked" : "Not linked"}
                            </StatusPill>
                          ),
                        },
                      ]}
                    />
                  </CardContent>
                  <CardFooter className="justify-end border-t">
                    <Button
                      disabled={
                        selected.size === 0 || assignLocations.isPending
                      }
                      onClick={async () => {
                        await assignLocations.mutateAsync({
                          clientId,
                          locationIds: [...selected],
                        })
                        toast.add({
                          title:
                            selected.size === 1
                              ? "1 location assigned"
                              : `${selected.size} locations assigned`,
                        })
                        setSelected(new Set())
                      }}
                    >
                      {selected.size === 0
                        ? "Assign to this client"
                        : `Assign ${selected.size} to this client`}
                    </Button>
                  </CardFooter>
                </Card>
              ) : null}
            </section>

            <section
              aria-labelledby="client-archive"
              className="flex flex-col gap-3"
            >
              <h2
                id="client-archive"
                className="text-title font-semibold text-ink"
              >
                Archive
              </h2>
              <GroupedList footer="Archiving hides the client from lists and filters. Its locations and review history are kept.">
                <GroupedListItem
                  icon={<ArchiveIcon />}
                  tone="danger"
                  label={`Archive ${client.name}`}
                  chevron={false}
                  disabled={update.isPending}
                  onClick={() => {
                    void archive()
                  }}
                />
              </GroupedList>
            </section>
          </div>
        )
      }}
    </QueryStates>
  )
}

function ClientDetailsForm({
  client,
  onSave,
  pending,
  error,
}: {
  client: ClientResponse["client"]
  onSave: (input: { name: string; notes: string | null }) => Promise<void>
  pending: boolean
  error: string | null
}) {
  const [name, setName] = React.useState(client.name)
  const [notes, setNotes] = React.useState(client.notes ?? "")
  const dirty = name !== client.name || notes !== (client.notes ?? "")

  return (
    <form
      className="max-w-lg"
      onSubmit={async (event) => {
        event.preventDefault()
        await onSave({ name: name.trim(), notes: notes.trim() || null })
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle as="h2">Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-(--np-gap-section)">
          <Field>
            <FieldLabel>Client name</FieldLabel>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field>
            <FieldLabel>Notes</FieldLabel>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              maxLength={2000}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="justify-end border-t">
          <Button type="submit" disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

export { ClientSettings }
