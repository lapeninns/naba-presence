"use client"

import { useRouter } from "next/navigation"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { QueryStates } from "@/components/ui/query-states"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { describeActionError } from "@/lib/errors/action-errors"
import type { ClientResponse } from "@/lib/contracts/clients"
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

        return (
          <div className="flex flex-col gap-8">
            <ClientDetailsForm
              client={client}
              onSave={async (input) => {
                await update.mutateAsync({ clientId, ...input })
                toast.add({ title: "Client updated" })
              }}
              pending={update.isPending}
              error={update.error ? describeActionError(update.error) : null}
            />

            <section aria-labelledby="client-locations-settings" className="flex flex-col gap-3">
              <div>
                <h2 id="client-locations-settings" className="text-section">
                  Locations
                </h2>
                <p className="text-ui text-ink-muted">
                  {mine.length === 0
                    ? "No locations are filed under this client yet."
                    : `${mine.length} location${mine.length === 1 ? "" : "s"} belong to this client.`}
                </p>
              </div>

              {mine.length > 0 ? (
                <DataTable
                  caption="Locations currently assigned to this client"
                  rows={mine}
                  rowId={(location) => location.id}
                  density="compact"
                  columns={[
                    { id: "name", header: "Location", cell: (l) => l.name },
                    {
                      id: "linked",
                      header: "Google",
                      cell: (l) => (l.linked ? "Linked" : "Not linked"),
                    },
                    {
                      id: "action",
                      header: "",
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
                <div className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-4">
                  <div>
                    <h3 className="text-title">Unassigned locations</h3>
                    <p className="text-caption text-ink-muted">
                      Imported from Google but not yet filed under a client.
                      Teammates who already hold every other location of this
                      client will get access to the ones you add.
                    </p>
                  </div>
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
                      { id: "name", header: "Location", cell: (l) => l.name },
                      {
                        id: "linked",
                        header: "Google",
                        cell: (l) => (l.linked ? "Linked" : "Not linked"),
                      },
                    ]}
                  />
                  <div>
                    <Button
                      disabled={selected.size === 0 || assignLocations.isPending}
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
                  </div>
                </div>
              ) : null}
            </section>

            <section aria-labelledby="client-archive" className="flex flex-col gap-3">
              <div>
                <h2 id="client-archive" className="text-section">
                  Archive
                </h2>
                <p className="text-ui text-ink-muted">
                  Archiving hides the client from lists and filters. Its
                  locations and review history are kept.
                </p>
              </div>
              <div>
                <Button
                  variant="outline"
                  className="text-danger-ink"
                  disabled={update.isPending}
                  onClick={async () => {
                    try {
                      await update.mutateAsync({ clientId, archived: true })
                      router.push("/clients")
                    } catch (error) {
                      // The server refuses while locations are attached; say
                      // what to do rather than failing silently.
                      toast.add({
                        title: "Cannot archive yet",
                        description: describeActionError(error),
                      })
                    }
                  }}
                >
                  Archive {client.name}
                </Button>
              </div>
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
      className="flex max-w-lg flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        await onSave({ name: name.trim(), notes: notes.trim() || null })
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-client-name">Client name</Label>
        <Input
          id="settings-client-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-client-notes">Notes</Label>
        <Textarea
          id="settings-client-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={2000}
        />
      </div>
      {error ? (
        <p role="alert" className="text-ui text-danger-ink">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  )
}

export { ClientSettings }
