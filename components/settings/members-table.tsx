"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Ellipsis,
  RefreshCw,
  Shield,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Users,
} from "lucide-react"
import { useState } from "react"

import {
  ChangeRoleDialog,
  RemoveMemberDialog,
} from "@/components/settings/member-dialogs"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { memberRowGate } from "@/lib/settings/gating"
import { roleLabel } from "@/lib/settings/forms/invitation"
import { accessSummary, formatDay, publishingState } from "@/lib/settings/roles"

/** Up to two initials from a display name, for the avatar fallback. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return parts
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
}

/**
 * Why the organisation-level publishing switch can't be changed for this
 * member, or null when it can. Owners and admins always publish, viewers
 * never do, and a member with per-listing grants publishes by those grants
 * (lib/server/permissions.ts), so the switch would change nothing.
 */
function publishReason(
  member: Member,
  gateReason: string | null
): string | null {
  if (member.role === "owner" || member.role === "admin")
    return "Owners and admins can always publish."
  if (member.role === "viewer") return "Viewers can’t publish."
  if (gateReason) return gateReason
  if (member.locations.length > 0)
    return "Set per listing, from each listing’s People with access page."
  return null
}

/**
 * The people in this organisation (reference `members-table`): who they
 * are, their role, which clients they can see, whether they can publish and
 * when they joined. Changes go through the row's menu: a role change and a
 * removal each confirm in a dialog; the publishing switch saves at once.
 * Under 720px of width the table becomes labelled rows.
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
  const [roleTarget, setRoleTarget] = useState<Member | null>(null)
  const [roleOpen, setRoleOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)

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
  })

  const removal = useMutation({
    mutationFn: (userId: string) => removeMember(userId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({ title: "Member removed", type: "success" })
    },
  })

  if (query.isPending) {
    return (
      <Card flush aria-busy="true" className="divide-y divide-line">
        <span className="sr-only" role="status">
          Loading members
        </span>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 p-3.5">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </Card>
    )
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn’t load your team</AlertTitle>
        <AlertDescription>
          {describeActionError(query.error)} Nobody’s access was changed.
        </AlertDescription>
        <AlertActions>
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        </AlertActions>
      </Alert>
    )
  }

  const members = query.data.members
  const ownerCount = members.filter((m) => m.role === "owner").length

  if (members.length === 0) {
    return (
      <Card flush>
        <Empty
          icon={<Users />}
          title="No members yet"
          description="People who accept an invitation appear here."
        />
      </Card>
    )
  }

  const busy = mutation.isPending || removal.isPending

  return (
    <>
      <Table surface responsive aria-label="Members">
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Client access</TableHead>
            <TableHead>Publishing</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const gate = memberRowGate({
              actorRole,
              actorUserId,
              ownerCount,
              member: m,
            })
            const access = accessSummary(m)
            const publishing = publishingState(m)
            const pubReason = publishReason(m, gate.roleReason)
            const isSelf = m.userId === actorUserId
            return (
              <TableRow key={m.userId} className="@max-[720px]/table:relative">
                <TableCell
                  label="Member"
                  className="@max-[720px]/table:pr-10"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar>
                      <AvatarFallback>{initials(m.displayName)}</AvatarFallback>
                    </Avatar>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5 font-semibold text-ink">
                        <span className="[overflow-wrap:anywhere]">
                          {m.displayName}
                        </span>
                        {isSelf ? <Badge variant="secondary">You</Badge> : null}
                      </span>
                      <span className="text-caption [overflow-wrap:anywhere] text-ink-muted">
                        {m.email}
                      </span>
                    </span>
                  </div>
                </TableCell>
                <TableCell label="Role">
                  <Badge variant="role">{roleLabel(m.role)}</Badge>
                </TableCell>
                <TableCell label="Client access">
                  <span className="flex flex-col">
                    <span>{access.label}</span>
                    {access.detail ? (
                      <span className="text-caption text-ink-muted">
                        {access.detail}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell label="Publishing">
                  <StatusPill
                    tone={publishing.tone}
                    dashed={publishing.dashed}
                    plain={publishing.plain}
                  >
                    {publishing.label}
                  </StatusPill>
                </TableCell>
                <TableCell label="Joined">
                  <span className="font-mono text-caption whitespace-nowrap text-ink-muted tabular-nums">
                    {formatDay(m.createdAt)}
                  </span>
                </TableCell>
                <TableCell
                  data-actions=""
                  className="text-right @max-[720px]/table:absolute @max-[720px]/table:top-2.5 @max-[720px]/table:right-2"
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${m.displayName}`}
                          disabled={busy}
                        />
                      }
                    >
                      <Ellipsis aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-w-[min(20rem,calc(100vw-24px))]">
                      <DropdownMenuItem
                        disabledReason={gate.roleReason ?? undefined}
                        onClick={() => {
                          mutation.reset()
                          setRoleTarget(m)
                          setRoleOpen(true)
                        }}
                      >
                        <Shield aria-hidden />
                        Change role…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabledReason={pubReason ?? undefined}
                        onClick={() =>
                          mutation.mutate(
                            {
                              userId: m.userId,
                              role: m.role,
                              canPublish: !m.canPublish,
                            },
                            {
                              onError: (error) =>
                                toast.add({
                                  title: describeActionError(error),
                                  type: "error",
                                }),
                            }
                          )
                        }
                      >
                        {m.canPublish ? (
                          <ShieldOff aria-hidden />
                        ) : (
                          <ShieldCheck aria-hidden />
                        )}
                        {m.canPublish
                          ? "Turn publishing off"
                          : "Allow publishing"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabledReason={gate.removeReason ?? undefined}
                        onClick={() => {
                          removal.reset()
                          setRemoveTarget(m)
                          setRemoveOpen(true)
                        }}
                      >
                        <Trash2 aria-hidden />
                        Remove from team…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <ChangeRoleDialog
        open={roleOpen}
        member={roleTarget}
        actorRole={actorRole}
        pending={mutation.isPending}
        error={mutation.isError ? describeActionError(mutation.error) : null}
        onOpenChange={setRoleOpen}
        onConfirm={(role) => {
          if (!roleTarget) return
          mutation.mutate(
            {
              userId: roleTarget.userId,
              role,
              canPublish: role === "viewer" ? false : roleTarget.canPublish,
            },
            { onSuccess: () => setRoleOpen(false) }
          )
        }}
      />
      <RemoveMemberDialog
        open={removeOpen}
        member={removeTarget}
        pending={removal.isPending}
        error={removal.isError ? describeActionError(removal.error) : null}
        onOpenChange={setRemoveOpen}
        onConfirm={() => {
          if (!removeTarget) return
          removal.mutate(removeTarget.userId, {
            onSuccess: () => setRemoveOpen(false),
          })
        }}
      />
    </>
  )
}
