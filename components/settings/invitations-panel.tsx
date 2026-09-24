"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Copy, Mail, RefreshCw, UserPlus } from "lucide-react"
import { useId, useRef, useState } from "react"

import { RoleCards } from "@/components/settings/member-dialogs"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
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
import { useInvitations } from "@/lib/queries/use-invitations"
import {
  createInvitation,
  revokeInvitation,
  type Invitation,
} from "@/lib/api/invitations"
import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  invitationFormSchema,
  roleLabel,
  type MemberRole,
} from "@/lib/settings/forms/invitation"
import { formatDay } from "@/lib/settings/roles"
import { cn } from "@/lib/utils"

function isExpired(invitation: Invitation): boolean {
  return (
    !invitation.acceptedAt &&
    new Date(invitation.expiresAt).getTime() <= Date.now()
  )
}

async function copyInviteLink(
  url: string,
  toast: ReturnType<typeof useToastManager>
) {
  try {
    await navigator.clipboard.writeText(url)
    toast.add({
      title: "Invite link copied",
      description: "Send it to them. It works once and expires after 7 days.",
      type: "success",
    })
  } catch {
    toast.add({
      title: "Couldn’t copy the link. Copy it manually.",
      description: url,
      type: "error",
    })
  }
}

/** Server refusals that belong to the email field rather than the form. */
const EMAIL_ERROR_CODES = new Set(["already_a_member", "invitation_pending"])

function publishHint(role: MemberRole): string {
  if (role === "viewer") return "Viewers can’t publish."
  if (role === "owner" || role === "admin")
    return "Owners and admins can always publish."
  return "Without this, their replies wait for someone who can publish."
}

/**
 * Invite someone: an email, a role chosen from the role cards, and whether
 * they may publish. Creating an invitation makes a link for you to share —
 * NabaPresence does not email it — and nothing changes until they accept.
 * Values survive a refused submit; a server refusal about the address is
 * shown on the address.
 *
 * `layout="card"` draws the form as a white card with its own submit
 * (setup); `layout="dialog"` lays it out as a dialog body and footer.
 */
/**
 * The link just created, kept on screen until the operator is done with it:
 * a toast that vanished in a few seconds was the only place it used to be.
 */
function CreatedInvite({
  created,
}: {
  created: { email: string; role: MemberRole; url: string }
}) {
  const toast = useToastManager()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-3" data-testid="invite-created">
      <Alert variant="success">
        <AlertTitle>Invitation ready</AlertTitle>
        <AlertDescription className="[overflow-wrap:anywhere]">
          {created.email} · {roleLabel(created.role)}. Send them this link. It
          works once and expires after 7 days.
        </AlertDescription>
      </Alert>
      <Field>
        <FieldLabel>Invite link</FieldLabel>
        <div className="flex min-w-0 gap-2">
          <Input
            ref={inputRef}
            readOnly
            value={created.url}
            className="min-w-0 flex-1 font-mono"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              inputRef.current?.select()
              void copyInviteLink(created.url, toast)
            }}
          >
            <Copy aria-hidden />
            Copy
          </Button>
        </div>
      </Field>
    </div>
  )
}

function InviteForm({
  actorRole,
  layout,
}: {
  actorRole: MemberRole
  layout: "card" | "dialog"
}) {
  const client = useQueryClient()
  const ids = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("member")
  const [canPublish, setCanPublish] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<{
    email: string
    role: MemberRole
    url: string
  } | null>(null)

  const create = useMutation({
    mutationFn: (input: {
      email: string
      role: MemberRole
      canPublish: boolean
    }) => createInvitation(input),
    onSuccess: async (result, input) => {
      setEmail("")
      setRole("member")
      setCanPublish(false)
      setEmailError(null)
      setFormError(null)
      setCreated({
        email: input.email,
        role: input.role,
        url: result.inviteUrl,
      })
      await client.invalidateQueries({ queryKey: queryKeys.invitations })
    },
    onError: (error) => {
      const message = describeActionError(error)
      if (
        error instanceof ApiClientError &&
        EMAIL_ERROR_CODES.has(error.code)
      ) {
        setEmailError(message)
        emailRef.current?.focus()
      } else {
        setFormError(message)
      }
    },
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const parsed = invitationFormSchema.safeParse({
      email: email.trim(),
      role,
      canPublish: role === "viewer" ? false : canPublish,
    })
    if (!parsed.success) {
      setEmailError(
        email.trim() === ""
          ? "Enter an email address."
          : (parsed.error.issues[0]?.message ?? "Enter a valid email address.")
      )
      emailRef.current?.focus()
      return
    }
    setEmailError(null)
    create.mutate(parsed.data)
  }

  const roleLabelId = `${ids}-role`
  const publishLabelId = `${ids}-publish`
  const publishHintId = `${ids}-publish-hint`

  const fields = (
    <>
      <Field error={emailError ?? undefined}>
        <FieldLabel>Email address</FieldLabel>
        <Input
          ref={emailRef}
          type="email"
          autoComplete="off"
          value={email}
          placeholder="name@example.com"
          onChange={(event) => {
            setEmail(event.target.value)
            if (emailError) setEmailError(null)
          }}
        />
        <FieldError>{emailError}</FieldError>
      </Field>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span id={roleLabelId} className="text-ui font-semibold text-ink">
          Role
        </span>
        <RoleCards
          actorRole={actorRole}
          value={role}
          onValueChange={setRole}
          labelledBy={roleLabelId}
          disabled={create.isPending}
        />
      </div>
      <div className="flex items-start justify-between gap-4 rounded-(--np-radius-control) bg-surface-alt px-3 py-2.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span id={publishLabelId} className="text-ui font-semibold text-ink">
            Can publish
          </span>
          <span id={publishHintId} className="text-caption text-ink-muted">
            {publishHint(role)}
          </span>
        </span>
        <Switch
          checked={role === "viewer" ? false : canPublish}
          disabled={role === "viewer" || create.isPending}
          aria-labelledby={publishLabelId}
          aria-describedby={publishHintId}
          onCheckedChange={(value) => setCanPublish(value)}
        />
      </div>
      {formError ? (
        <Alert variant="destructive">
          <AlertTitle>The invitation wasn’t created</AlertTitle>
          <AlertDescription>
            {formError} Your entries are kept, so you can try again.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )

  const submit = (
    <Button type="submit" pending={create.isPending} pendingLabel="Creating…">
      Create invite link
    </Button>
  )

  const inviteAnother = (
    <Button
      type="button"
      variant="ghost"
      onClick={() => {
        setCreated(null)
        // After the reset renders the fields again.
        setTimeout(() => emailRef.current?.focus(), 0)
      }}
    >
      Invite someone else
    </Button>
  )

  if (created && layout === "dialog") {
    return (
      <>
        <DialogBody>
          <CreatedInvite created={created} />
        </DialogBody>
        <DialogFooter>
          {inviteAnother}
          <DialogClose render={<Button>Done</Button>} />
        </DialogFooter>
      </>
    )
  }

  if (created) {
    return (
      <div className="flex flex-col gap-4 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)">
        <CreatedInvite created={created} />
        <div className="flex justify-end">{inviteAnother}</div>
      </div>
    )
  }

  if (layout === "dialog") {
    return (
      <form noValidate onSubmit={onSubmit} className="contents">
        <DialogBody>{fields}</DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          {submit}
        </DialogFooter>
      </form>
    )
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)"
    >
      {fields}
      <div className="flex justify-end">{submit}</div>
    </form>
  )
}

/** "Invite a teammate", as a dialog (Team's header action and `#invite`). */
export function InviteDialog({
  actorRole,
  open,
  onOpenChange,
}: {
  actorRole: MemberRole
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wide" className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            You get a link to send them; NabaPresence doesn’t email it. Nothing
            changes until they accept, and the link expires after 7 days.
          </DialogDescription>
        </DialogHeader>
        {/* Stays open on success to show the link; Done closes it. */}
        <InviteForm actorRole={actorRole} layout="dialog" />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The invitations nobody has accepted yet (reference `invites-table`):
 * address and when it was created, role, publishing, whether the link still
 * works, and Copy link / Revoke. Labelled rows under 720px.
 */
export function InvitationsList({ onInvite }: { onInvite?: () => void }) {
  const query = useInvitations()
  const client = useQueryClient()
  const toast = useToastManager()
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null)

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: async (_result, id) => {
      const email = query.data?.items.find((item) => item.id === id)?.email
      await client.invalidateQueries({ queryKey: queryKeys.invitations })
      toast.add({
        title: "Invitation revoked",
        description: email
          ? `The link for ${email} no longer works.`
          : undefined,
        type: "success",
      })
    },
    onError: (error) =>
      toast.add({ title: describeActionError(error), type: "error" }),
  })

  if (query.isPending) {
    return (
      <Skeleton
        aria-busy="true"
        className="h-24 w-full rounded-(--np-radius-card)"
      />
    )
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn’t load invitations</AlertTitle>
        <AlertDescription>{describeActionError(query.error)}</AlertDescription>
        <AlertActions>
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        </AlertActions>
      </Alert>
    )
  }
  if (query.data.items.length === 0) {
    return (
      <Card flush>
        <Empty
          icon={<Mail />}
          title="No pending invitations"
          description="Invite a teammate to give them access. Accepted invitations move to Members."
          action={
            onInvite ? (
              <Button variant="secondary" onClick={onInvite}>
                <UserPlus aria-hidden />
                Invite a teammate
              </Button>
            ) : undefined
          }
        />
      </Card>
    )
  }

  return (
    <>
      <Table surface responsive aria-label="Pending invitations">
        <TableHeader>
          <TableRow>
            <TableHead>Invited</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Publishing</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.items.map((invitation) => {
            const expired = isExpired(invitation)
            return (
              <TableRow key={invitation.id}>
                <TableCell label="Invited">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold [overflow-wrap:anywhere] text-ink">
                      {invitation.email}
                    </span>
                    <span className="text-caption text-ink-muted">
                      Created {formatDay(invitation.createdAt)}
                    </span>
                  </span>
                </TableCell>
                <TableCell label="Role">
                  <Badge variant="role">{roleLabel(invitation.role)}</Badge>
                </TableCell>
                <TableCell label="Publishing">
                  {invitation.role === "viewer" ? (
                    <StatusPill tone="neutral" plain>
                      View only
                    </StatusPill>
                  ) : invitation.canPublish ||
                    invitation.role === "owner" ||
                    invitation.role === "admin" ? (
                    <StatusPill tone="ok">Can publish</StatusPill>
                  ) : (
                    <StatusPill tone="neutral" dashed>
                      Drafts only
                    </StatusPill>
                  )}
                </TableCell>
                <TableCell label="Status">
                  <span className="flex flex-col gap-1">
                    {expired ? (
                      <StatusPill tone="warn">Expired</StatusPill>
                    ) : (
                      <StatusPill tone="neutral" dashed>
                        Pending
                      </StatusPill>
                    )}
                    <span className="text-caption text-ink-muted">
                      {expired ? "Expired" : "Expires"}{" "}
                      {formatDay(invitation.expiresAt)}
                    </span>
                  </span>
                </TableCell>
                <TableCell data-actions="" className="text-right">
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5 @max-[720px]/table:justify-start">
                    {invitation.inviteUrl ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Copy invite link for ${invitation.email}`}
                        disabledReason={
                          expired
                            ? "This link has expired. Revoke it and invite them again."
                            : undefined
                        }
                        onClick={() =>
                          copyInviteLink(invitation.inviteUrl!, toast)
                        }
                      >
                        <Copy aria-hidden />
                        Copy link
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger-ink"
                      disabled={revoke.isPending}
                      aria-label={`Revoke invitation for ${invitation.email}`}
                      onClick={() => setRevokeTarget(invitation)}
                    >
                      Revoke
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
      >
        <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
          <AlertDialogTitle className="[overflow-wrap:anywhere]">
            Revoke the invitation for {revokeTarget?.email}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The link stops working straight away. To bring them in later, send a
            new invitation.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Keep it</Button>}
            />
            <Button
              variant="danger"
              pending={revoke.isPending}
              pendingLabel="Revoking…"
              onClick={() => {
                if (!revokeTarget) return
                revoke.mutate(revokeTarget.id, {
                  onSettled: () => setRevokeTarget(null),
                })
              }}
            >
              Revoke invitation
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * The invite form and the pending invitations together, for a page that
 * has no header action to hang a dialog on (setup's Team step).
 */
export function InvitationsPanel({
  actorRole,
  className,
}: {
  actorRole: MemberRole
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <InviteForm actorRole={actorRole} layout="card" />
      <InvitationsList />
    </div>
  )
}
