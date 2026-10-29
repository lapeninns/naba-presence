"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type * as React from "react"
import { useState } from "react"

import {
  AccessScopeForm,
  firstName,
  type AccessScopeItem,
} from "@/components/settings/access-scope-form"
import { describeMemberError } from "@/components/settings/member-dialogs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { Skeleton } from "@/components/ui/skeleton"
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
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { workspaceTerms } from "@/lib/workspace/terms"

import { LocationAccessForm } from "./location-access-form"

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
 * A bottom sheet on a phone; an accidental dismissal with unsaved changes
 * asks before throwing them away.
 */
export function ClientAccessDialog({
  open,
  member,
  onOpenChange,
  finalFocus,
}: {
  open: boolean
  /** Kept after close so the popup does not empty while it animates out. */
  member: Member | null
  onOpenChange: (open: boolean) => void
  /**
   * Where focus goes when it closes; by default, back to what opened it.
   * Pass it when the opener is gone (a member sheet that handed over).
   */
  finalFocus?: React.RefObject<HTMLElement | null>
}) {
  const terms = workspaceTerms(useWorkspaceMode())
  // Unsaved picks guard an accidental dismissal; cleared whenever it closes.
  const [dirty, setDirty] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setDirty(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      discardPrompt={{
        description:
          "These changes haven’t been saved. Their access stays as it was.",
      }}
    >
      <DialogContent
        size="wide"
        className="grid-cols-[minmax(0,1fr)]"
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>{terms.access}</DialogTitle>
          <DialogDescription>
            {member
              ? `Choose which ${terms.scopePlural} ${member.displayName} can see. Their role still decides what they can do there.`
              : null}
          </DialogDescription>
        </DialogHeader>
        {member && open ? (
          <ClientAccessLoader
            key={member.userId}
            member={member}
            onDirtyChange={setDirty}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ClientAccessLoader({
  member,
  onDirtyChange,
  onDone,
}: {
  member: Member
  onDirtyChange: (dirty: boolean) => void
  onDone: () => void
}) {
  const query = useClientAccess(member.userId)
  const business = useWorkspaceMode() === "business"
  return (
    <QueryStates
      status={queryStatus(query)}
      pending={
        <DialogBody aria-busy="true">
          <span className="sr-only" role="status">
            {business ? "Loading location access" : "Loading client access"}
          </span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </DialogBody>
      }
      error={{
        title: "We couldn’t load their access",
        description: `${describeActionError(query.error)} Nothing was changed.`,
      }}
      onRetry={() => void query.refetch()}
    >
      {() =>
        business ? (
          <LocationAccessForm
            member={member}
            access={query.data!}
            onDirtyChange={onDirtyChange}
            onDone={onDone}
          />
        ) : (
          <ClientAccessForm
            member={member}
            access={query.data!}
            onDirtyChange={onDirtyChange}
            onDone={onDone}
          />
        )
      }
    </QueryStates>
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
  onDirtyChange,
  onDone,
}: {
  member: Member
  access: ClientAccessResponse
  onDirtyChange?: (dirty: boolean) => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const toast = useToastManager()
  const [mode, setMode] = useState<"all" | "some">(
    access.allClients ? "all" : "some"
  )
  const [picks, setPicks] = useState(() => initialPicks(access))
  const [dirty, setDirtyState] = useState(false)
  const name = firstName(member.displayName)
  const isMember = access.role === "member"
  const markDirty = () => {
    if (!dirty) onDirtyChange?.(true)
    setDirtyState(true)
  }

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
          : result.noAccess
            ? `${member.displayName} can’t see any client until you give them access.`
            : undefined,
        type: "success",
      })
      onDone()
    },
  })

  const rows = access.clients
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
  const update = (next: (current: Map<string, ClientPick>) => void) => {
    setPicks((current) => {
      const copy = new Map(current)
      next(copy)
      return copy
    })
    markDirty()
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

  const items: AccessScopeItem[] = rows.map((row) => {
    const pick = picks.get(row.clientId)
    const partial =
      pick?.listings === "unchanged" &&
      row.granted > 0 &&
      row.granted < row.total
    const empty = row.total === 0 && row.granted === 0
    return {
      id: row.clientId,
      name: row.name,
      label: row.archived ? `${row.name} (archived)` : row.name,
      description: empty
        ? "No listings yet, so ticking it gives nothing"
        : partial
          ? `Some listings: ${row.granted} of ${row.total}, kept as they are`
          : listings(row.total),
      checked: Boolean(pick),
      indeterminate: partial,
      disabled: empty && !pick,
      action: partial ? (
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
      ) : undefined,
      publish:
        isMember && pick
          ? {
              checked: publishChecked(row, pick),
              label:
                pick.canPublish === undefined && row.publishing === "some"
                  ? "Publishes to some"
                  : "Can publish",
            }
          : undefined,
    }
  })

  return (
    <>
      <DialogBody>
        <AccessScopeForm
          noun={{ one: "client", many: "clients" }}
          legend={`Which clients ${name} can see`}
          mode={mode}
          onModeChange={(next) => {
            setMode(next)
            markDirty()
          }}
          allOption={{
            title: "All clients, including ones added later",
            description: `${name} sees every client’s reviews and listings, now and in future.`,
          }}
          someOption={{
            title: "Only these clients",
            description:
              "They see only the clients you tick. New clients stay hidden until you add them here.",
          }}
          items={items}
          emptyMessage={`There are no clients yet. Add a client and its listings first, or leave ${name} on All clients.`}
          onToggle={(clientId, checked) =>
            update((current) => {
              const row = rows.find((entry) => entry.clientId === clientId)
              if (checked && row) {
                current.set(clientId, {
                  listings: row.granted > 0 ? "unchanged" : "all",
                })
              } else {
                current.delete(clientId)
              }
            })
          }
          onPublishChange={(clientId, value) =>
            update((current) => {
              const pick = current.get(clientId)
              if (pick) current.set(clientId, { ...pick, canPublish: value })
            })
          }
          disabled={save.isPending}
          note={
            isMember
              ? undefined
              : "Viewers can’t publish, whichever clients they see."
          }
        />
        {mode === "all" && isMember ? (
          <p className="text-ui text-ink-muted">
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
              {describeMemberError(save.error)}
            </AlertDescription>
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button
          disabled={!dirty}
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
