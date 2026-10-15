"use client"

import {
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query"
import { Building2, Ellipsis, Shield, Trash2, Users } from "lucide-react"
import { useRef, useState } from "react"

import { ClientAccessDialog } from "@/components/settings/client-access-dialog"
import {
  ChangeRoleDialog,
  RemoveMemberDialog,
} from "@/components/settings/member-dialogs"
import {
  MemberSheet,
  type MemberSheetDetail,
} from "@/components/settings/member-sheet"
import {
  MembersSkeleton,
  RoleControl,
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
import { ListRow, ListRows } from "@/components/ui/list-row"
import type {
  ListRowSwipeAction,
  ListRowSwipeActions,
} from "@/components/ui/list-row-swipe"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
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
import { useOptimisticMutation } from "@/lib/queries/use-optimistic-mutation"
import {
  removeMember,
  updateMember,
  type Member,
  type MemberClientTotal,
  type MemberRole,
} from "@/lib/api/members"
import type { MembersResponse } from "@/lib/contracts/members"
import { describeActionError } from "@/lib/errors/action-errors"
import { useHydratedBreakpoint } from "@/lib/hooks/use-media-query"
import { memberRowGate } from "@/lib/settings/gating"
import { accessSummary, formatDay, publishingState } from "@/lib/settings/roles"
import { cn } from "@/lib/utils"
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

const PUBLISH_KEY = ["members", "publish"] as const

/** The last publishing save on a row, shown beside its switch. */
type PublishOutcome =
  | { userId: string; status: "saved"; canPublish: boolean }
  | { userId: string; status: "error"; message: string }

/**
 * The people in this organisation (reference `members-table`): who they
 * are, their role, which clients they can see, whether they can publish and
 * when they joined.
 *
 * On a phone each member is one `ListRow` (SET-02): avatar, name, the full
 * email, and under it the role chip with "All clients · Can publish". The
 * role chip opens Change role in one tap (SET-10); the row opens the member
 * sheet (role, access, the publishing switch, Remove); its "⋯" holds Client
 * access and Remove. From md the bordered table stays: the role chip opens
 * Change role there too, and the row menu has every action.
 * Publishing saves at once and says so beside its switch: saving, saved, or
 * why it wasn't changed.
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
      pending={<MembersSkeleton label="Loading members" />}
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

/** One member's derived state: what the row, the sheet and the table show. */
type MemberView = {
  member: Member
  isSelf: boolean
  gate: ReturnType<typeof memberRowGate>
  access: ReturnType<typeof accessSummary>
  publishing: ReturnType<typeof publishingState>
  publishReason: string | null
  accessReason: string | null
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
  // Null in the server and hydration renders: both faces, switched in CSS.
  const wide = useHydratedBreakpoint("md")
  const [roleTarget, setRoleTarget] = useState<Member | null>(null)
  const [roleOpen, setRoleOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [accessTarget, setAccessTarget] = useState<Member | null>(null)
  const [accessOpen, setAccessOpen] = useState(false)
  const [sheetUserId, setSheetUserId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // The row that opened the sheet. A dialog the sheet hands over to returns
  // focus there, since the sheet's own row (its opener) is gone by then.
  const sheetOpener = useRef<HTMLElement | null>(null)
  const [handedOver, setHandedOver] = useState(false)
  // The last publishing save per member, so overlapping saves each keep
  // their own outcome.
  const [publishOutcomes, setPublishOutcomes] = useState<
    Record<string, PublishOutcome | undefined>
  >({})
  const setPublishOutcome = (userId: string, outcome?: PublishOutcome) =>
    setPublishOutcomes((current) => ({ ...current, [userId]: outcome }))

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

  // Publishing autosaves per row and shows at once, so its outcome is told
  // beside the switch rather than in an alert at the top of the page. The
  // switch puts itself back if the save fails.
  const publish = useOptimisticMutation<
    unknown,
    { userId: string; role: MemberRole; canPublish: boolean },
    MembersResponse
  >({
    mutationKey: PUBLISH_KEY,
    mutationFn: (input) => updateMember(input),
    queryKey: queryKeys.members,
    update: (current, input) =>
      current && {
        ...current,
        members: current.members.map((member) =>
          member.userId === input.userId
            ? { ...member, canPublish: input.canPublish }
            : member
        ),
      },
    // The failure is told inline beside the switch, not in a toast too.
    errorToast: false,
    errorTitle: "Publishing wasn’t changed",
  })
  // The members whose publishing save is in flight: only their switches wait.
  const publishingUserIds = useMutationState({
    filters: { mutationKey: PUBLISH_KEY, status: "pending" },
    select: (mutation) =>
      (mutation.state.variables as { userId: string }).userId,
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

  const views: MemberView[] = members.map((m) => {
    const gate = memberRowGate({
      actorRole,
      actorUserId,
      ownerCount,
      member: m,
    })
    return {
      member: m,
      isSelf: m.userId === actorUserId,
      gate,
      access: accessSummary(m, clients, mode),
      publishing: publishingState(m),
      publishReason: publishReason(m, gate.roleReason, terms),
      accessReason: clientAccessReason(m, terms),
    }
  })

  const openRole = (m: Member) => {
    setHandedOver(false)
    mutation.reset()
    setRoleTarget(m)
    setRoleOpen(true)
  }
  const openAccess = (m: Member) => {
    setHandedOver(false)
    setAccessTarget(m)
    setAccessOpen(true)
  }
  const openRemove = (m: Member) => {
    removal.reset()
    setRemoveTarget(m)
    setRemoveOpen(true)
  }
  // The sheet hands over to a dialog: it closes first, so two sheets never
  // stack on a phone.
  const fromSheet = (open: (m: Member) => void) => (m: Member) => {
    setSheetOpen(false)
    open(m)
    setHandedOver(true)
  }
  const returnFocus = handedOver ? sheetOpener : undefined

  // `where` keeps the status ids apart when a widened screen draws the
  // table while the sheet is still open.
  const publishControl = (view: MemberView, where: "table" | "sheet") => {
    const m = view.member
    const saving = publishingUserIds.includes(m.userId)
    const outcome = publishOutcomes[m.userId] ?? null
    return {
      checked: m.canPublish,
      disabled: saving || busy,
      onCheckedChange: (value: boolean) => {
        setPublishOutcome(m.userId)
        // `mutateAsync`: per-call `mutate` callbacks only fire for the latest
        // call, so toggling a second member would drop the first one's
        // outcome.
        publish
          .mutateAsync({ userId: m.userId, role: m.role, canPublish: value })
          .then(
            () =>
              setPublishOutcome(m.userId, {
                userId: m.userId,
                status: "saved",
                canPublish: value,
              }),
            (error: unknown) =>
              setPublishOutcome(m.userId, {
                userId: m.userId,
                status: "error",
                message: describeActionError(error),
              })
          )
      },
      status: (
        <PublishStatus
          id={`publish-status-${where}-${m.userId}`}
          saving={saving}
          outcome={outcome}
        />
      ),
    }
  }

  const sheetView = views.find((v) => v.member.userId === sheetUserId) ?? null
  const sheetDetail: MemberSheetDetail | null = sheetView
    ? {
        member: sheetView.member,
        accessName: terms.access,
        accessLabel: sheetView.access.label,
        accessDetail: sheetView.access.detail,
        publishingLabel: sheetView.publishing.label,
        roleReason: sheetView.gate.roleReason,
        accessReason: sheetView.accessReason,
        removeReason: sheetView.gate.removeReason,
        publishReason: sheetView.publishReason,
        publishSwitch:
          sheetView.publishReason === null
            ? publishControl(sheetView, "sheet")
            : null,
      }
    : null

  const list = (
    <ListRows
      aria-label="Members"
      bleed
      data-slot="member-list"
      className={wide === null ? "md:hidden" : undefined}
    >
      {views.map((view) => {
        const m = view.member
        const quick: ListRowSwipeAction[] = [
          view.accessReason === null
            ? {
                label: terms.access,
                icon: <Building2 aria-hidden />,
                onAction: () => openAccess(m),
                disabled: busy,
              }
            : null,
          view.gate.removeReason === null
            ? {
                label: "Remove",
                icon: <Trash2 aria-hidden />,
                tone: "danger" as const,
                onAction: () => openRemove(m),
                disabled: busy,
              }
            : null,
        ].filter((action) => action !== null)
        // A swipe holds one or two; an unavailable one is left out (the
        // sheet still shows it, with its reason).
        const swipe: ListRowSwipeActions | undefined =
          quick.length === 2
            ? [quick[0], quick[1]]
            : quick.length === 1
              ? [quick[0]]
              : undefined
        return (
          <ListRow
            key={m.userId}
            emphasis="neutral"
            wrap
            leading={<MemberAvatar name={m.displayName} />}
            title={
              <>
                {m.displayName}
                {view.isSelf ? (
                  <Badge variant="secondary" className="ms-1.5 align-middle">
                    You
                  </Badge>
                ) : null}
              </>
            }
            subtitle={m.email}
            aria-label={`${m.displayName}${view.isSelf ? " (you)" : ""}, ${m.email}`}
            aria-haspopup="dialog"
            onClick={(event) => {
              sheetOpener.current = event.currentTarget
              setSheetUserId(m.userId)
              setSheetOpen(true)
            }}
            footer={
              <>
                <RoleControl
                  role={m.role}
                  name={m.displayName}
                  reason={view.gate.roleReason}
                  disabled={busy}
                  onChangeRole={() => openRole(m)}
                />
                <span
                  data-slot="member-summary"
                  className="text-caption text-ink-muted"
                >
                  {view.access.label} · {view.publishing.label}
                </span>
              </>
            }
            swipeActions={swipe}
            actionsLabel={`Actions for ${m.displayName}`}
          />
        )
      })}
    </ListRows>
  )

  const table = (
    <Table
      surface
      responsive
      aria-label="Members"
      className={TEAM_LIST_TABLE_CLASS}
      containerClassName={cn(
        TEAM_LIST_CONTAINER_CLASS,
        wide === null && "max-md:hidden"
      )}
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
        {views.map((view) => {
          const m = view.member
          const control = publishControl(view, "table")
          return (
            // The menu is a flex item of the card's title line, after the
            // role badge, so a long name wraps beside it instead of running
            // under a pinned button (the old 360px overlap).
            <TableRow key={m.userId}>
              <TableCell label="Member" priority="primary" className="min-w-0">
                <div className="flex min-w-0 items-center gap-2.5">
                  <MemberAvatar name={m.displayName} />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-body font-semibold text-ink desk:text-ui">
                      <span className="[overflow-wrap:anywhere]">
                        {m.displayName}
                      </span>
                      {view.isSelf ? (
                        <Badge variant="secondary">You</Badge>
                      ) : null}
                    </span>
                    {/* One line with an ellipsis where the role pill shares
                        the title line (a narrow table); the full address
                        stays in the title and the accessible name. */}
                    <span
                      title={m.email}
                      data-slot="member-email"
                      className="truncate text-caption text-ink-muted"
                    >
                      {m.email}
                    </span>
                  </span>
                </div>
              </TableCell>
              <TableCell label="Role" priority="trailing">
                <RoleControl
                  role={m.role}
                  name={m.displayName}
                  reason={view.gate.roleReason}
                  disabled={busy}
                  onChangeRole={() => openRole(m)}
                />
              </TableCell>
              <TableCell label={terms.access} span>
                <span className="flex min-w-0 flex-col">
                  <span className="[overflow-wrap:anywhere]">
                    {view.access.label}
                  </span>
                  {view.access.detail ? (
                    <span className="text-caption text-ink-muted">
                      {view.access.detail}
                    </span>
                  ) : null}
                </span>
              </TableCell>
              <TableCell label="Publishing" span>
                {view.publishReason === null ? (
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex min-h-(--np-touch) items-center gap-2.5 desk:min-h-8">
                      <span className="whitespace-nowrap">
                        {view.publishing.label}
                      </span>
                      <Switch
                        checked={control.checked}
                        disabled={control.disabled}
                        aria-label={`Allow ${m.displayName} to publish`}
                        aria-describedby={`publish-status-table-${m.userId}`}
                        onCheckedChange={control.onCheckedChange}
                      />
                    </span>
                    {control.status}
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-col items-start gap-1">
                    <StatusPill
                      tone={view.publishing.tone}
                      dashed={view.publishing.dashed}
                      plain={view.publishing.plain}
                    >
                      {view.publishing.label}
                    </StatusPill>
                    {m.role === "member" ? (
                      <span className="text-caption text-ink-muted">
                        {view.publishReason}
                      </span>
                    ) : null}
                  </span>
                )}
              </TableCell>
              <TableCell label="Joined" priority="meta">
                <span
                  data-slot="member-joined"
                  className="text-caption whitespace-nowrap text-ink-muted tabular-nums"
                >
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
                      disabledReason={view.gate.roleReason ?? undefined}
                      onClick={() => openRole(m)}
                    >
                      <Shield aria-hidden />
                      Change role…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabledReason={view.accessReason ?? undefined}
                      onClick={() => openAccess(m)}
                    >
                      <Building2 aria-hidden />
                      {terms.access}…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabledReason={view.gate.removeReason ?? undefined}
                      onClick={() => openRemove(m)}
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
  )

  return (
    <>
      {wide === null ? (
        <>
          {list}
          {table}
        </>
      ) : wide ? (
        table
      ) : (
        list
      )}

      <MemberSheet
        open={sheetOpen}
        detail={sheetDetail}
        onOpenChange={setSheetOpen}
        onChangeRole={fromSheet(openRole)}
        onChangeAccess={fromSheet(openAccess)}
        onRemove={fromSheet(openRemove)}
      />
      <ChangeRoleDialog
        open={roleOpen}
        member={roleTarget}
        actorRole={actorRole}
        pending={mutation.isPending}
        error={mutation.isError ? describeActionError(mutation.error) : null}
        onOpenChange={setRoleOpen}
        finalFocus={returnFocus}
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
        finalFocus={returnFocus}
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

function MemberAvatar({ name }: { name: string }) {
  return (
    <Avatar>
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

/**
 * Saving, saved or why it failed, beside (or under) a publishing switch.
 * Always rendered, so the live region exists before it has news.
 */
function PublishStatus({
  id,
  saving,
  outcome,
}: {
  id: string
  saving: boolean
  outcome: PublishOutcome | null
}) {
  return (
    <>
      <span
        id={id}
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
        <span role="alert" className="basis-full text-ui text-danger-ink">
          Publishing wasn’t changed. {outcome.message}
        </span>
      ) : null}
    </>
  )
}
