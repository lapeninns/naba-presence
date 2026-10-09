"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useId, useMemo, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ChoiceCard } from "@/components/ui/choice-card"
import { DialogBody, DialogClose, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RadioGroup } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useToastManager } from "@/components/ui/toast"
import { updateClientAccess, type Member } from "@/lib/api/members"
import type {
  ClientAccessResponse,
  ClientAccessUpdateInput,
} from "@/lib/contracts/client-access"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationDirectory } from "@/lib/queries/use-locations"

/** Above this many locations the checklist gets a search box. */
const SEARCH_THRESHOLD = 8

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

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
  onDone,
}: {
  member: Member
  access: ClientAccessResponse
  onDone: () => void
}) {
  const ids = useId()
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
  const [dirty, setDirty] = useState(false)
  const [search, setSearch] = useState("")
  const name = firstName(member.displayName)
  const isMember = access.role === "member"

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
          : undefined,
        type: "success",
      })
      onDone()
    },
  })

  const locations = directory.data
  const visible = useMemo(() => {
    const all = locations ?? []
    const needle = search.trim().toLowerCase()
    if (!needle) return all
    return all.filter((entry) => entry.name.toLowerCase().includes(needle))
  }, [locations, search])

  const update = (next: (current: Map<string, boolean>) => void) => {
    setPicks((current) => {
      const copy = new Map(current)
      next(copy)
      return copy
    })
    setDirty(true)
  }

  const nothingPicked = mode === "some" && picks.size === 0
  const consequence =
    mode === "all"
      ? `${name} will see every location, including ones added later.`
      : picks.size === 0
        ? `Choose at least one location. With none, ${name} would see every location, so it can’t be saved that way.`
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

  const modeLabelId = `${ids}-mode`
  const listLabelId = `${ids}-list`

  return (
    <>
      <DialogBody>
        <span id={modeLabelId} className="sr-only">
          Which locations {name} can see
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
            title="All locations, including ones added later"
            description={`${name} sees every location’s reviews, now and in future.`}
          />
          <ChoiceCard
            value="some"
            title="Only these locations"
            description="They see only the locations you tick. New locations stay hidden until you add them here."
          />
        </RadioGroup>

        {mode === "some" ? (
          <div className="flex min-w-0 flex-col gap-2">
            <span id={listLabelId} className="text-ui font-semibold text-ink">
              Locations
            </span>
            {(locations?.length ?? 0) > SEARCH_THRESHOLD ? (
              <Input
                type="search"
                aria-label="Search locations"
                placeholder="Search locations"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onClear={() => setSearch("")}
              />
            ) : null}
            {directory.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : directory.isError ? (
              <p className="text-caption text-ink-muted">
                {describeActionError(directory.error)}
              </p>
            ) : (
              <ul
                aria-labelledby={listLabelId}
                className="flex flex-col divide-y divide-line rounded-(--np-radius-card) border border-line"
              >
                {visible.map((entry) => {
                  const picked = picks.has(entry.id)
                  return (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5"
                    >
                      <Checkbox
                        checked={picked}
                        disabled={save.isPending}
                        label={entry.name}
                        onCheckedChange={(checked) =>
                          update((current) => {
                            if (checked) current.set(entry.id, false)
                            else current.delete(entry.id)
                          })
                        }
                      />
                      {isMember && picked ? (
                        <span className="flex items-center gap-2 text-caption text-ink-muted">
                          Can publish
                          <Switch
                            checked={picks.get(entry.id) === true}
                            disabled={save.isPending}
                            aria-label={`Can publish to ${entry.name}`}
                            onCheckedChange={(value) =>
                              update((current) => current.set(entry.id, value))
                            }
                          />
                        </span>
                      ) : null}
                    </li>
                  )
                })}
                {visible.length === 0 && (locations?.length ?? 0) > 0 ? (
                  <li className="px-3 py-2.5 text-caption text-ink-muted">
                    No locations match “{search}”.
                  </li>
                ) : null}
              </ul>
            )}
            {!isMember ? (
              <p className="text-caption text-ink-muted">
                Viewers can’t publish, whichever locations they see.
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
          {consequence}
        </p>
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
          disabled={!dirty || nothingPicked}
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
