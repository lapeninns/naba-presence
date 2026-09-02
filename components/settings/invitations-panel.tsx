"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { useInvitations } from "@/lib/queries/use-invitations"
import { createInvitation, revokeInvitation, type Invitation } from "@/lib/api/invitations"
import { describeActionError } from "@/lib/errors/action-errors"
import { roleOptionsFor } from "@/lib/settings/gating"
import { invitationFormSchema, roleLabel, type MemberRole } from "@/lib/settings/forms/invitation"

function isExpired(invitation: Invitation): boolean {
  return !invitation.acceptedAt && new Date(invitation.expiresAt).getTime() <= Date.now()
}

async function copyInviteLink(url: string, toast: ReturnType<typeof useToastManager>) {
  try {
    await navigator.clipboard.writeText(url)
    toast.add({ title: "Invite link copied", type: "success" })
  } catch {
    toast.add({ title: "Couldn’t copy the link. Copy it manually.", type: "error" })
  }
}

export function InvitationsPanel({ actorRole }: { actorRole: MemberRole }) {
  const query = useInvitations()
  const client = useQueryClient()
  const toast = useToastManager()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("member")
  const [canPublish, setCanPublish] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: (input: { email: string; role: MemberRole; canPublish: boolean }) => createInvitation(input),
    onSuccess: async (result) => {
      setEmail("")
      setRole("member")
      setCanPublish(false)
      setEmailError(null)
      await client.invalidateQueries({ queryKey: queryKeys.invitations })
      toast.add({
        title: "Invitation sent",
        description: "Copy the invite link to share it.",
        type: "success",
        actionProps: { children: "Copy link", onClick: () => copyInviteLink(result.inviteUrl, toast) },
      })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.invitations })
      toast.add({ title: "Invitation revoked", type: "success" })
    },
    onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = invitationFormSchema.safeParse({
      email,
      role,
      canPublish: role === "viewer" ? false : canPublish,
    })
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? "Enter a valid email address.")
      return
    }
    create.mutate(parsed.data)
  }

  const options = roleOptionsFor(actorRole)

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
        <Field error={emailError ?? undefined} className="min-w-56 flex-1">
          <FieldLabel>Email address</FieldLabel>
          <Input
            type="email"
            value={email}
            aria-label="Email address"
            placeholder="name@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          <FieldError>{emailError}</FieldError>
        </Field>
        <Select value={role} onValueChange={(value) => setRole(value as MemberRole)}>
          <SelectTrigger aria-label="Invitation role" className="w-36">
            <SelectValue>{roleLabel(role)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-ui">
          <Checkbox
            checked={role === "viewer" ? false : canPublish}
            disabled={role === "viewer"}
            aria-label="Can publish"
            onCheckedChange={(value) => setCanPublish(value === true)}
          />
          <span>Can publish</span>
        </label>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Sending…" : "Send invitation"}
        </Button>
      </form>

      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <Empty title="We couldn’t load invitations" description={describeActionError(query.error)} />
      ) : query.data.items.length === 0 ? (
        <Empty title="No pending invitations" description="Invite a teammate to give them access." />
      ) : (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.items.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="font-medium">{invitation.email}</TableCell>
                <TableCell>{roleLabel(invitation.role)}</TableCell>
                <TableCell>
                  {isExpired(invitation) ? (
                    <Badge variant="warning">Expired</Badge>
                  ) : (
                    <Badge variant="secondary">Pending</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex gap-2">
                    {invitation.inviteUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Copy invite link for ${invitation.email}`}
                        onClick={() => copyInviteLink(invitation.inviteUrl!, toast)}
                      >
                        Copy link
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      aria-label={`Revoke invitation for ${invitation.email}`}
                      onClick={() => revoke.mutate(invitation.id)}
                    >
                      Revoke
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
