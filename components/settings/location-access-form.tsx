"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  AccessScopeForm,
  firstName,
  type AccessScopeItem,
} from "@/components/settings/access-scope-form"
import { describeMemberError } from "@/components/settings/member-dialogs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DialogBody, DialogFooter } from "@/components/ui/dialog"
import { queryStatus } from "@/components/ui/query-states"
import { useToastManager } from "@/components/ui/toast"
import { updateClientAccess, type Member } from "@/lib/api/members"
import type {
  ClientAccessResponse,
  ClientAccessUpdateInput,
} from "@/lib/contracts/client-access"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationDirectory } from "@/lib/queries/use-locations"

/**
 * The business-mode form of "Location access…": access is edited a location
 * at a time, because a business has no client layer to tick. Saved as the
 * same location_member rows (`{ locations }` on PUT
 * /api/members/[userId]/client-access); the server still refuses the empty
 * selection that would silently mean everything.
 */
export function LocationAccessForm({
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
  const queryClient = useQueryClient()
  const toast = useToastManager()
  // Only owners and admins open this dialog, so the management directory.
  const directory = useLocationDirectory("owner")
  const [mode, setMode] = useState<"all" | "some">(
    access.allClients ? "all" : "some"
  )
  // location id -> can publish
  const [picks, setPicks] = useState<Map<string, boolean>>(
    () =>
      new Map(
        access.allClients
          ? []
          : access.locationGrants.map((grant) => [
              grant.locationId,
              grant.canPublish,
            ])
      )
  )
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
      queryClient.setQueryData(
        queryKeys.memberClientAccess(member.userId),
        result
      )
      await queryClient.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({
        title: "Location access saved",
        description: result.allClients
          ? `${member.displayName} can see every location.`
          : result.noAccess
            ? `${member.displayName} can’t see any location until you give them access.`
            : undefined,
        type: "success",
      })
      onDone()
    },
  })

  const update = (next: (current: Map<string, boolean>) => void) => {
    setPicks((current) => {
      const copy = new Map(current)
      next(copy)
      return copy
    })
    markDirty()
  }

  const consequence =
    mode === "all"
      ? `${name} will see every location, including ones added later.`
      : picks.size === 0
        ? `${name} will see no locations until you give them access. They stay on the team.`
        : `${name} will see ${picks.size === 1 ? "1 location" : `${picks.size} locations`}. Locations added later stay hidden from them.`

  const onSave = () => {
    if (mode === "all") {
      save.mutate({ allClients: true })
      return
    }
    save.mutate({
      locations: [...picks].map(([locationId, canPublish]) => ({
        locationId,
        ...(isMember ? { canPublish } : {}),
      })),
    })
  }

  const items: AccessScopeItem[] = (directory.data ?? []).map((entry) => {
    const picked = picks.has(entry.id)
    return {
      id: entry.id,
      name: entry.name,
      checked: picked,
      publish:
        isMember && picked
          ? { checked: picks.get(entry.id) === true, label: "Can publish" }
          : undefined,
    }
  })

  return (
    <>
      <DialogBody>
        <AccessScopeForm
          noun={{ one: "location", many: "locations" }}
          legend={`Which locations ${name} can see`}
          mode={mode}
          onModeChange={(next) => {
            setMode(next)
            markDirty()
          }}
          allOption={{
            title: "All locations, including ones added later",
            description: `${name} sees every location’s reviews, now and in future.`,
          }}
          someOption={{
            title: "Only these locations",
            description:
              "They see only the locations you tick. New locations stay hidden until you add them here.",
          }}
          items={items}
          itemsStatus={queryStatus(directory)}
          itemsError={directory.error}
          onRetryItems={() => void directory.refetch()}
          emptyMessage="There are no locations yet."
          onToggle={(id, checked) =>
            update((current) => {
              if (checked) current.set(id, false)
              else current.delete(id)
            })
          }
          onPublishChange={(id, value) =>
            update((current) => current.set(id, value))
          }
          disabled={save.isPending}
          note={
            isMember
              ? undefined
              : "Viewers can’t publish, whichever locations they see."
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
          {consequence}
        </p>
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
