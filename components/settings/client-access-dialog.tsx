"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { useId, useMemo, useState } from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ChoiceCard } from "@/components/ui/choice-card"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RadioGroup } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useToastManager } from "@/components/ui/toast"
import { updateClientAccess, type Member } from "@/lib/api/members"
import type {
  ClientAccessResponse,
  ClientAccessRow,
  ClientAccessUpdateInput,
} from "@/lib/contracts/client-access"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import { useClientAccess } from "@/lib/queries/use-members"
import { describeAccessChange } from "@/lib/settings/client-access"

/** Above this many clients the checklist gets a search box. */
const SEARCH_THRESHOLD = 8

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function listings(count: number) {
  return `${count} ${count === 1 ? "listing" : "listings"}`
}

/**
 * One ticked client. `unchanged` keeps the rows the member already holds for
 * it exactly as they are (older per-listing grants); `all` grants every
 * listing filed under it. `canPublish` undefined leaves publishing as it is.
 */
type ClientPick = { listings: "all" | "unchanged"; canPublish?: boolean }

/**
 * "Client access…" on a Team row: all clients (including ones added later)
 * or only the ticked ones, each with its listing count and, for members, a
 * Can publish switch. The consequence is spelled out before saving, with a
 * warning when the change widens or narrows what they see. Saved as
 * location_member rows by PUT /api/members/[userId]/client-access; the
 * server refuses the one change that would silently mean "everything".
 */
export function ClientAccessDialog({
  open,
  member,
  onOpenChange,
}: {
  open: boolean
  /** Kept after close so the popup does not empty while it animates out. */
  member: Member | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wide" className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Client access</DialogTitle>
          <DialogDescription>
            {member
              ? `Choose which clients ${member.displayName} can see. Their role still decides what they can do there.`
              : null}
          </DialogDescription>
        </DialogHeader>
        {member && open ? (
          <ClientAccessLoader
            key={member.userId}
            member={member}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ClientAccessLoader({
  member,
  onDone,
}: {
  member: Member
  onDone: () => void
}) {
  const query = useClientAccess(member.userId)
  if (query.isPending) {
    return (
      <DialogBody aria-busy="true">
        <span className="sr-only" role="status">
          Loading client access
        </span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </DialogBody>
    )
  }
  if (query.isError) {
    return (
      <DialogBody>
        <Alert variant="destructive">
          <AlertTitle>We couldn’t load their access</AlertTitle>
          <AlertDescription>
            {describeActionError(query.error)} Nothing was changed.
          </AlertDescription>
          <AlertActions>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => query.refetch()}
            >
              <RefreshCw aria-hidden />
              Try again
            </Button>
          </AlertActions>
        </Alert>
      </DialogBody>
    )
  }
  return (
    <ClientAccessForm member={member} access={query.data} onDone={onDone} />
  )
}

function initialPicks(access: ClientAccessResponse): Map<string, ClientPick> {
  const picks = new Map<string, ClientPick>()
  if (access.allClients) return picks
  for (const row of access.clients) {
    if (row.granted > 0) picks.set(row.clientId, { listings: "unchanged" })
  }
  return picks
}

function publishChecked(row: ClientAccessRow, pick: ClientPick): boolean {
  if (pick.canPublish !== undefined) return pick.canPublish
  // A newly ticked client starts Drafts only; a held one shows what it has.
  if (pick.listings === "all" && row.granted === 0) return false
  return row.publishing === "all"
}

export function ClientAccessForm({
  member,
  access,
  onDone,
}: {
  member: Member
  access: ClientAccessResponse
  onDone: () => void
}) {
  const ids = useId()
  const client = useQueryClient()
  const toast = useToastManager()
  const [mode, setMode] = useState<"all" | "some">(
    access.allClients ? "all" : "some"
  )
  const [picks, setPicks] = useState(() => initialPicks(access))
  const [dirty, setDirty] = useState(false)
  const [search, setSearch] = useState("")
  const name = firstName(member.displayName)
  const isMember = access.role === "member"

  const save = useMutation({
    mutationFn: (input: ClientAccessUpdateInput) =>
      updateClientAccess(member.userId, input),
    onSuccess: async (result) => {
      client.setQueryData(queryKeys.memberClientAccess(member.userId), result)
      await client.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({
        title: "Client access saved",
        description: result.allClients
          ? `${member.displayName} can see every client.`
          : undefined,
        type: "success",
      })
      onDone()
    },
  })

  const rows = access.clients
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) => row.name.toLowerCase().includes(needle))
  }, [rows, search])

  const selected = rows
    .filter((row) => picks.has(row.clientId))
    .map((row) => ({
      name: row.name,
      listings:
        picks.get(row.clientId)!.listings === "all" ? row.total : row.granted,
    }))
  const change = describeAccessChange({
    name,
    before: access,
    allClients: mode === "all",
    selected,
    totalClients: rows.filter((row) => row.total > 0).length,
  })
  const nothingGranted =
    mode === "some" && selected.every((client) => client.listings === 0)

  const update = (next: (current: Map<string, ClientPick>) => void) => {
    setPicks((current) => {
      const copy = new Map(current)
      next(copy)
      return copy
    })
    setDirty(true)
  }

  const onSave = () => {
    if (mode === "all") {
      save.mutate({ allClients: true })
      return
    }
    save.mutate({
      clients: [...picks].map(([clientId, pick]) => ({
        clientId,
        listings: pick.listings,
        ...(isMember && pick.canPublish !== undefined
          ? { canPublish: pick.canPublish }
          : {}),
      })),
    })
  }

  const modeLabelId = `${ids}-mode`
  const listLabelId = `${ids}-list`

  return (
    <>
      <DialogBody>
        <span id={modeLabelId} className="sr-only">
          Which clients {name} can see
        </span>
        <RadioGroup
          value={mode}
          onValueChange={(next) => {
            setMode(next as "all" | "some")
            setDirty(true)
          }}
          aria-labelledby={modeLabelId}
          disabled={save.isPending}
          className="grid grid-cols-1 gap-2"
        >
          <ChoiceCard
            value="all"
            title="All clients, including ones added later"
            description={`${name} sees every client’s reviews and listings, now and in future.`}
          />
          <ChoiceCard
            value="some"
            title="Only these clients"
            description="They see only the clients you tick. New clients stay hidden until you add them here."
          />
        </RadioGroup>

        {mode === "some" ? (
          <div className="flex min-w-0 flex-col gap-2">
            <span id={listLabelId} className="text-ui font-semibold text-ink">
              Clients
            </span>
            {rows.length > SEARCH_THRESHOLD ? (
              <Input
                type="search"
                aria-label="Search clients"
                placeholder="Search clients"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onClear={() => setSearch("")}
              />
            ) : null}
            {rows.length === 0 ? (
              <p className="text-caption text-ink-muted">
                There are no clients yet. Add a client and its listings first,
                or leave {name} on All clients.
              </p>
            ) : null}
            <ul
              aria-labelledby={listLabelId}
              className="flex flex-col divide-y divide-line rounded-(--np-radius-card) border border-line"
            >
              {visibleRows.map((row) => {
                const pick = picks.get(row.clientId)
                const partial =
                  pick?.listings === "unchanged" &&
                  row.granted > 0 &&
                  row.granted < row.total
                const empty = row.total === 0 && row.granted === 0
                const description = empty
                  ? "No listings yet, so ticking it gives nothing"
                  : partial
                    ? `Some listings: ${row.granted} of ${row.total}, kept as they are`
                    : listings(row.total)
                return (
                  <li
                    key={row.clientId}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5"
                  >
                    <Checkbox
                      checked={Boolean(pick)}
                      indeterminate={partial}
                      disabled={save.isPending || (empty && !pick)}
                      label={row.archived ? `${row.name} (archived)` : row.name}
                      description={description}
                      onCheckedChange={(checked) =>
                        update((current) => {
                          if (checked) {
                            current.set(row.clientId, {
                              listings: row.granted > 0 ? "unchanged" : "all",
                            })
                          } else {
                            current.delete(row.clientId)
                          }
                        })
                      }
                    />
                    <span className="flex items-center gap-3">
                      {partial ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={save.isPending}
                          onClick={() =>
                            update((current) =>
                              current.set(row.clientId, {
                                listings: "all",
                                canPublish: pick?.canPublish,
                              })
                            )
                          }
                        >
                          Give all {row.total}
                        </Button>
                      ) : null}
                      {isMember && pick ? (
                        <span className="flex items-center gap-2 text-caption text-ink-muted">
                          {pick.canPublish === undefined &&
                          row.publishing === "some"
                            ? "Publishes to some"
                            : "Can publish"}
                          <Switch
                            checked={publishChecked(row, pick)}
                            disabled={save.isPending}
                            aria-label={`Can publish to ${row.name}`}
                            onCheckedChange={(value) =>
                              update((current) =>
                                current.set(row.clientId, {
                                  ...pick,
                                  canPublish: value,
                                })
                              )
                            }
                          />
                        </span>
                      ) : null}
                    </span>
                  </li>
                )
              })}
              {visibleRows.length === 0 && rows.length > 0 ? (
                <li className="px-3 py-2.5 text-caption text-ink-muted">
                  No clients match “{search}”.
                </li>
              ) : null}
            </ul>
            {!isMember ? (
              <p className="text-caption text-ink-muted">
                Viewers can’t publish, whichever clients they see.
              </p>
            ) : null}
          </div>
        ) : isMember ? (
          <p className="text-caption text-ink-muted">
            Publishing follows {name}’s Publishing setting on the team list.
          </p>
        ) : null}

        <p
          className="text-ui text-ink"
          role="status"
          data-testid="access-consequence"
        >
          {change.consequence}
        </p>
        {change.warning ? (
          <Alert variant="warning">
            <AlertTitle>{change.warning.title}</AlertTitle>
            <AlertDescription>{change.warning.body}</AlertDescription>
          </Alert>
        ) : null}
        {save.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Access wasn’t changed</AlertTitle>
            <AlertDescription>
              {describeActionError(save.error)}
            </AlertDescription>
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost">Cancel</Button>} />
        <Button
          disabled={!dirty || nothingGranted}
          pending={save.isPending}
          pendingLabel="Saving…"
          onClick={onSave}
        >
          Save access
        </Button>
      </DialogFooter>
    </>
  )
}
