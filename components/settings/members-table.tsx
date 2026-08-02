"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { GateNote } from "@/components/locations/publish-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { useMembers } from "@/lib/queries/use-members"
import { removeMember, updateMember, type Member, type MemberRole } from "@/lib/api/members"
import { describeActionError } from "@/lib/settings/action-errors"
import { memberRowGate, roleOptionsFor } from "@/lib/settings/gating"
import { roleLabel } from "@/lib/settings/forms/invitation"

export function MembersTable({ actorRole, actorUserId }: { actorRole: MemberRole; actorUserId: string }) {
  const query = useMembers()
  const client = useQueryClient()
  const toast = useToastManager()

  const mutation = useMutation({
    mutationFn: (input: { userId: string; role: MemberRole; canPublish: boolean }) => updateMember(input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({ title: "Team updated", type: "success" })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  const removal = useMutation({
    mutationFn: (userId: string) => removeMember(userId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.members })
      toast.add({ title: "Member removed", type: "success" })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  if (query.isPending) {
    return <Skeleton className="h-40 w-full" />
  }
  if (query.isError) {
    return (
      <Empty
        title="We couldn’t load your team"
        description={describeActionError(query.error)}
        action={<Button variant="outline" onClick={() => query.refetch()}>Try again</Button>}
      />
    )
  }

  const members = query.data.members
  const ownerCount = members.filter((m) => m.role === "owner").length
  const options = roleOptionsFor(actorRole)

  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Can publish</TableHead>
          <TableHead>Remove</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m: Member) => {
          const gate = memberRowGate({ actorRole, actorUserId, ownerCount, member: m })
          const busy = mutation.isPending || removal.isPending
          return (
            <TableRow key={m.userId}>
              <TableCell>
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    {m.displayName}
                    {m.userId === actorUserId ? <Badge variant="secondary">You</Badge> : null}
                  </span>
                  <span className="text-caption text-muted-foreground">{m.email}</span>
                </span>
              </TableCell>
              <TableCell>
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
                  <SelectTrigger aria-label={`Role for ${m.displayName}`} className="w-36">
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
                <GateNote reason={gate.roleReason} />
              </TableCell>
              <TableCell>
                <Checkbox
                  checked={m.canPublish && !gate.canPublishForced}
                  disabled={gate.canPublishForced || gate.roleDisabled || busy}
                  aria-label={`Publishing access for ${m.displayName}`}
                  onCheckedChange={(value) =>
                    mutation.mutate({ userId: m.userId, role: m.role, canPublish: value === true })
                  }
                />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={gate.removeDisabled || busy}
                  aria-label={`Remove ${m.displayName}`}
                  onClick={() => removal.mutate(m.userId)}
                >
                  Remove
                </Button>
                <GateNote reason={gate.removeReason} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
