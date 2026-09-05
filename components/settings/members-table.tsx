"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Users } from "lucide-react"

import { GateNote } from "@/components/locations/publish-gate"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { useMembers } from "@/lib/queries/use-members"
import {
  removeMember,
  updateMember,
  type Member,
  type MemberRole,
} from "@/lib/api/members"
import { describeActionError } from "@/lib/errors/action-errors"
import { memberRowGate, roleOptionsFor } from "@/lib/settings/gating"
import { roleLabel } from "@/lib/settings/forms/invitation"

/** Up to two initials from a display name, for the avatar fallback. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return parts
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
}

/**
 * The people in this organisation, as a Mac-style list: avatar, name and
 * email on the left; the role pop-up, a publishing switch and Remove on the
 * right. Every change saves immediately — a role is one decision, and a
 * form-with-Save for a list of people would leave half-made changes behind.
 */
export function MembersTable({
  actorRole,
  actorUserId,
}: {
  actorRole: MemberRole
  actorUserId: string
}) {
  const query = useMembers()
  const client = useQueryClient()
  const toast = useToastManager()

  const mutation = useMutation({
    mutationFn: (input: {
      userId: string
      role: MemberRole
      canPublish: boolean
    }) => updateMember(input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({ title: "Team updated", type: "success" })
    },
    onError: (error) =>
      toast.add({ title: describeActionError(error), type: "error" }),
  })

  const removal = useMutation({
    mutationFn: (userId: string) => removeMember(userId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({ title: "Member removed", type: "success" })
    },
    onError: (error) =>
      toast.add({ title: describeActionError(error), type: "error" }),
  })

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-[calc(var(--np-row-h)*3)] w-full rounded-(--np-radius-card)" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <Empty
        title="We couldn’t load your team"
        description={describeActionError(query.error)}
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const members = query.data.members
  const ownerCount = members.filter((m) => m.role === "owner").length
  const options = roleOptionsFor(actorRole)

  if (members.length === 0) {
    return (
      <Empty
        icon={<Users />}
        title="No members yet"
        description="People who accept an invitation appear here."
      />
    )
  }

  return (
    <ul
      aria-label="Members"
      className="divide-y divide-line-subtle overflow-hidden rounded-(--np-radius-card) bg-surface"
    >
      {members.map((m: Member) => {
        const gate = memberRowGate({
          actorRole,
          actorUserId,
          ownerCount,
          member: m,
        })
        const busy = mutation.isPending || removal.isPending
        return (
          <li
            key={m.userId}
            className="flex flex-col gap-3 px-(--np-card-pad) py-3 md:flex-row md:items-center"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar>
                <AvatarFallback>{initials(m.displayName)}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 text-body font-medium text-ink">
                  <span className="truncate">{m.displayName}</span>
                  {m.userId === actorUserId ? (
                    <Badge variant="tinted" shape="tag">
                      You
                    </Badge>
                  ) : null}
                </span>
                <span className="truncate text-caption text-ink-muted">
                  {m.email}
                </span>
                <GateNote reason={gate.roleReason} />
                <GateNote reason={gate.removeReason} />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:justify-end">
              <Select
                value={m.role}
                disabled={gate.roleDisabled || busy}
                onValueChange={(role) =>
                  mutation.mutate({
                    userId: m.userId,
                    role: role as MemberRole,
                    canPublish: role === "viewer" ? false : m.canPublish,
                  })
                }
              >
                <SelectTrigger
                  aria-label={`Role for ${m.displayName}`}
                  className="w-36"
                >
                  <SelectValue>{roleLabel(m.role)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="flex items-center gap-2 text-ui text-ink-muted">
                <span aria-hidden>Can publish</span>
                <Switch
                  checked={m.canPublish && !gate.canPublishForced}
                  disabled={gate.canPublishForced || gate.roleDisabled || busy}
                  aria-label={`Publishing access for ${m.displayName}`}
                  onCheckedChange={(value) =>
                    mutation.mutate({
                      userId: m.userId,
                      role: m.role,
                      canPublish: value,
                    })
                  }
                />
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-ink"
                disabled={gate.removeDisabled || busy}
                aria-label={`Remove ${m.displayName}`}
                onClick={() => removal.mutate(m.userId)}
              >
                Remove
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
