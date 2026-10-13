"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Building2, Ellipsis, Shield, Trash2, Users } from "lucide-react"
import { useState } from "react"

import { ClientAccessDialog } from "@/components/settings/client-access-dialog"
import {
  ChangeRoleDialog,
  RemoveMemberDialog,
} from "@/components/settings/member-dialogs"
import {
  RoleChip,
  TEAM_LIST_CONTAINER_CLASS,
  TEAM_LIST_TABLE_CLASS,
} from "@/components/settings/team-list"
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
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { StatusPill } from "@/components/ui/status-pill"
import { Switch } from "@/components/ui/switch"
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
  type MemberClientTotal,
  type MemberRole,
} from "@/lib/api/members"
import { describeActionError } from "@/lib/errors/action-errors"
import { memberRowGate } from "@/lib/settings/gating"
import { accessSummary, formatDay, publishingState } from "@/lib/settings/roles"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { workspaceTerms, type WorkspaceTerms } from "@/lib/workspace/terms"

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
  gateReason: string | null,
  terms: WorkspaceTerms
): string | null {
  if (member.role === "owner" || member.role === "admin")
    return "Owners and admins can always publish."
  if (member.role === "viewer") return "Viewers can’t publish."
  if (gateReason) return gateReason
  if (member.locations.length > 0)
    return `Set per ${terms.scope}, from ${terms.access}.`
  return null
}

/** Why "Client access…" is unavailable for this row, or null. */
function clientAccessReason(
  member: Member,
  terms: WorkspaceTerms
): string | null {
  if (member.role === "owner" || member.role === "admin")
    return `Owners and admins always see every ${terms.scope}.`
  return null
}

/** The last publishing save on a row, shown beside its switch. */
type PublishOutcome =
  | { userId: string; status: "saved"; canPublish: boolean }
  | { userId: string; status: "error"; message: string }

/**
 * The people in this organisation (reference `members-table`): who they
 * are, their role, which clients they can see, whether they can publish and
 * when they joined. A role change, client access and a removal each open a
 * dialog from the row's menu (an action sheet on a phone). Publishing is a
 * switch in its own cell that saves at once and says so beside it: saving,
 * saved, or why it wasn't changed.
 * Below 48rem of its own width each member is a record card (see
 * `TableCellPriority`): the member, their role badge and the menu on the
 * title line, when they joined on the muted line under it, then access and
 * publishing each across the card, where a long access summary or a switch
 * with its status can wrap.
 */
export function MembersTable({
  actorRole,
  actorUserId,
}: {
  actorRole: MemberRole
  actorUserId: string
}) {
  const query = useMembers()
  return (
    <QueryStates
      status={queryStatus(query, {
        isEmpty: query.data?.members.length === 0,
      })}
      pending={
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
      }
      error={{
        title: "We couldn’t load your team",
        description: `${describeActionError(query.error)} Nobody’s access was changed.`,
      }}
      onRetry={() => void query.refetch()}
      empty={
        <Card flush>
          <Empty
            icon={<Users />}
            title="No members yet"
            description="People who accept an invitation appear here."
          />
        </Card>
      }
    >
      {() => (
        <MemberRows
          actorRole={actorRole}
          actorUserId={actorUserId}
          members={query.data!.members}
          clients={query.data!.clients}
        />
      )}
    </QueryStates>
  )
}

function MemberRows({
  actorRole,
  actorUserId,
  members,
  clients,
}: {
  actorRole: MemberRole
  actorUserId: string
  members: Member[]
  clients: MemberClientTotal[] | undefined
}) {
  const mode = useWorkspaceMode()
  const terms = workspaceTerms(mode)
  const client = useQueryClient()
  const toast = useToastManager()
  const [roleTarget, setRoleTarget] = useState<Member | null>(null)
  const [roleOpen, setRoleOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [accessTarget, setAccessTarget] = useState<Member | null>(null)
  const [accessOpen, setAccessOpen] = useState(false)
  const [publishOutcome, setPublishOutcome] = useState<PublishOutcome | null>(
    null
  )

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

  // Publishing autosaves per row, so its outcome is told beside the switch
  // rather than in a toast or an alert at the top of the page.
  const publish = useMutation({
    mutationFn: (input: {
      userId: string
      role: MemberRole
      canPublish: boolean
    }) => updateMember(input),
    onMutate: () => setPublishOutcome(null),
    onSuccess: async (_result, input) => {
      await client.invalidateQueries({ queryKey: queryKeys.members })
      setPublishOutcome({
        userId: input.userId,
        status: "saved",
        canPublish: input.canPublish,
      })
    },
    onError: (error, input) =>
      setPublishOutcome({
        userId: input.userId,
        status: "error",
        message: describeActionError(error),
      }),
  })

  const removal = useMutation({
    mutationFn: (userId: string) => removeMember(userId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({ title: "Member removed", type: "success" })
    },
  })

  const ownerCount = members.filter((m) => m.role === "owner").length
  const busy = mutation.isPending || removal.isPending

  return (
    <>
      <Table
        surface
        responsive
        aria-label="Members"
        className={TEAM_LIST_TABLE_CLASS}
        containerClassName={TEAM_LIST_CONTAINER_CLASS}
      >
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>{terms.access}</TableHead>
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
            const access = accessSummary(m, clients, mode)
            const publishing = publishingState(m)
            const pubReason = publishReason(m, gate.roleReason, terms)
            const isSelf = m.userId === actorUserId
            const saving =
              publish.isPending && publish.variables?.userId === m.userId
            const outcome =
              publishOutcome?.userId === m.userId ? publishOutcome : null
            return (
              // The menu is a flex item of the card's title line, after the
              // role badge, so a long name wraps beside it instead of running
              // under a pinned button (the old 360px overlap).
              <TableRow key={m.userId}>
                <TableCell label="Member" priority="primary">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar>
                      <AvatarFallback>{initials(m.displayName)}</AvatarFallback>
                    </Avatar>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-body font-semibold text-ink desk:text-ui">
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
                <TableCell label="Role" priority="trailing">
                  <RoleChip role={m.role} />
                </TableCell>
                <TableCell label={terms.access} span>
                  <span className="flex min-w-0 flex-col">
                    <span className="[overflow-wrap:anywhere]">
                      {access.label}
                    </span>
                    {access.detail ? (
                      <span className="text-caption text-ink-muted">
                        {access.detail}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell label="Publishing" span>
                  {pubReason === null ? (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex min-h-(--np-touch) items-center gap-2.5 desk:min-h-8">
                        <Switch
                          checked={m.canPublish}
                          disabled={saving || busy}
                          aria-label={`Allow ${m.displayName} to publish`}
                          aria-describedby={`publish-status-${m.userId}`}
                          onCheckedChange={(value) =>
                            publish.mutate({
                              userId: m.userId,
                              role: m.role,
                              canPublish: value,
                            })
                          }
                        />
                        <span className="whitespace-nowrap">
                          {publishing.label}
                        </span>
                      </span>
                      <span
                        id={`publish-status-${m.userId}`}
                        role="status"
                        className="flex min-w-0 items-center gap-1.5 text-ui text-ink-muted"
                      >
                        {saving ? (
                          <>
                            <Spinner decorative size="sm" />
                            Saving…
                          </>
                        ) : outcome?.status === "saved" ? (
                          outcome.canPublish ? (
                            "Saved: publishing on"
                          ) : (
                            "Saved: drafts only"
                          )
                        ) : null}
                      </span>
                      {!saving && outcome?.status === "error" ? (
                        <span
                          role="alert"
                          className="basis-full text-ui text-danger-ink"
                        >
                          Publishing wasn’t changed. {outcome.message}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-col items-start gap-1">
                      <StatusPill
                        tone={publishing.tone}
                        dashed={publishing.dashed}
                        plain={publishing.plain}
                      >
                        {publishing.label}
                      </StatusPill>
                      {m.role === "member" ? (
                        <span className="text-caption text-ink-muted">
                          {pubReason}
                        </span>
                      ) : null}
                    </span>
                  )}
                </TableCell>
                <TableCell label="Joined" priority="meta">
                  <span className="font-mono text-caption whitespace-nowrap text-ink-muted tabular-nums">
                    {formatDay(m.createdAt)}
                  </span>
                </TableCell>
                <TableCell actions className="text-right">
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
                    <DropdownMenuContent
                      title={m.displayName}
                      className="data-[presentation=popover]:max-w-80"
                    >
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
                        disabledReason={
                          clientAccessReason(m, terms) ?? undefined
                        }
                        onClick={() => {
                          setAccessTarget(m)
                          setAccessOpen(true)
                        }}
                      >
                        <Building2 aria-hidden />
                        {terms.access}…
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
      <ClientAccessDialog
        open={accessOpen}
        member={accessTarget}
        onOpenChange={setAccessOpen}
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
