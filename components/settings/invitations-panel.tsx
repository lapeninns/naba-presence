"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Copy,
  Ellipsis,
  Mail,
  Send,
  Share,
  Trash2,
  UserPlus,
} from "lucide-react"
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react"

import { AccessScopeForm } from "@/components/settings/access-scope-form"
import { RoleCards } from "@/components/settings/member-dialogs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  RoleChip,
  TEAM_LIST_CONTAINER_CLASS,
  TEAM_LIST_TABLE_CLASS,
} from "@/components/settings/team-list"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, cardClassName } from "@/components/ui/card"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input, inputHints } from "@/components/ui/input"
import {
  QueryStates,
  queryStatus,
  type QueryStatus,
} from "@/components/ui/query-states"
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
import { useClients } from "@/lib/queries/use-clients"
import {
  useInvitations,
  useResendInvitation,
} from "@/lib/queries/use-invitations"
import {
  createInvitation,
  revokeInvitation,
  type Invitation,
  type InvitationDelivery,
} from "@/lib/api/invitations"
import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  invitationFormSchema,
  roleLabel,
  type MemberRole,
} from "@/lib/settings/forms/invitation"
import {
  canResendInvitation,
  describeInvitationDelivery,
} from "@/lib/settings/invitation-delivery"
import { formatDay } from "@/lib/settings/roles"
import { shareLink } from "@/lib/setup/share-link"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

function isExpired(invitation: Invitation): boolean {
  return (
    !invitation.acceptedAt &&
    new Date(invitation.expiresAt).getTime() <= Date.now()
  )
}

type Toasts = ReturnType<typeof useToastManager>

async function copyInviteLink(url: string, toast: Toasts) {
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

/**
 * Whether this browser has a system share sheet (phones, and some desktops),
 * so a Share button is worth drawing. Read on the client only; `shareLink`
 * asks again at the moment of sharing.
 */
function canShareLink(url: string): boolean {
  if (typeof navigator === "undefined") return false
  if (typeof navigator.share !== "function") return false
  if (typeof navigator.canShare !== "function") return true
  try {
    return navigator.canShare({ url })
  } catch {
    return false
  }
}

const noSubscription = () => () => {}

/** `canShareLink` for rendering: false on the server and while hydrating. */
function useCanShareLink(url: string): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => canShareLink(url),
    () => false
  )
}

/**
 * Hands the invite link to the share sheet, so it goes out by Messages,
 * WhatsApp or mail without a copy and paste; without one, `shareLink` copies
 * it instead. Only the accept link the server returned (the one Copy copies)
 * is shared, with a fixed title and sentence: never the page URL, and not
 * the invitee's address, so nothing else lands in another app. Closing the
 * sheet is not a failure.
 */
async function shareInviteLink(url: string, toast: Toasts) {
  const outcome = await shareLink({
    url,
    title: "Join our team on NabaPresence",
    text: "Your invitation to join. The link works once and expires after 7 days.",
  })
  if (outcome === "copied") {
    toast.add({
      title: "Invite link copied",
      description: "Send it to them. It works once and expires after 7 days.",
      type: "success",
    })
  } else if (outcome === "failed") {
    toast.add({
      title: "Couldn’t share the link. Copy it manually.",
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
 * Whether this organisation's invitations are emailed by the app (the
 * `invitation_email` feature, read from the invitations list). Off, an
 * invitation is a link the inviter copies and sends.
 */
function useEmailDelivery(): boolean {
  return useInvitations().data?.emailDelivery === true
}

/**
 * The state of an invitation email, as a pill and the sentence under it.
 * `id` lets the row's Resend button point at it.
 */
function DeliveryState({
  delivery,
  id,
}: {
  delivery: InvitationDelivery | null | undefined
  id?: string
}) {
  const view = describeInvitationDelivery(delivery, formatDay)
  return (
    <span
      className="flex flex-col items-start gap-1"
      data-slot="invite-delivery"
    >
      <StatusPill tone={view.tone} dashed={view.dashed}>
        {view.label}
      </StatusPill>
      <span id={id} className="text-caption text-ink-muted">
        {view.detail}
      </span>
    </span>
  )
}

/**
 * The link just created, kept on screen until the operator is done with it:
 * a toast that vanished in a few seconds was the only place it used to be.
 */
function CreatedInvite({
  created,
}: {
  created: {
    email: string
    role: MemberRole
    url: string
    access: string
    /** Set when the organisation emails its invitations. */
    delivery?: InvitationDelivery | null
  }
}) {
  const toast = useToastManager()
  const inputRef = useRef<HTMLInputElement>(null)
  const canShare = useCanShareLink(created.url)
  const who = `${created.email} · ${roleLabel(created.role)} · ${created.access}.`
  const emailed = created.delivery !== undefined
  const status = created.delivery?.status
  return (
    <div className="flex flex-col gap-3" data-testid="invite-created">
      {!emailed ? (
        <Alert variant="success">
          <AlertTitle>Invitation ready</AlertTitle>
          <AlertDescription className="[overflow-wrap:anywhere]">
            {who} Send them this link. It works once and expires after 7 days.
          </AlertDescription>
        </Alert>
      ) : status === "sent" ? (
        <Alert variant="success">
          <AlertTitle>Invitation emailed</AlertTitle>
          <AlertDescription className="[overflow-wrap:anywhere]">
            {who} We emailed them the link. It works once and expires after 7
            days; you can also copy it below.
          </AlertDescription>
        </Alert>
      ) : status === "pending" ? (
        <Alert variant="info">
          <AlertTitle>Invitation created, email on its way</AlertTitle>
          <AlertDescription className="[overflow-wrap:anywhere]">
            {who} The email is queued and Team shows when it goes out. The link
            below works meanwhile and expires after 7 days.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <AlertTitle>Invitation created, but the email wasn’t sent</AlertTitle>
          <AlertDescription className="[overflow-wrap:anywhere]">
            {who}{" "}
            {describeInvitationDelivery(created.delivery, formatDay).detail} The
            link works once and expires after 7 days.
          </AlertDescription>
        </Alert>
      )}
      <Field>
        <FieldLabel>Invite link</FieldLabel>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Input
            ref={inputRef}
            readOnly
            value={created.url}
            className="min-w-0 flex-1 basis-56 font-mono"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex gap-2 max-sm:w-full max-sm:*:flex-1">
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
            {canShare ? (
              <Button
                type="button"
                onClick={() => void shareInviteLink(created.url, toast)}
              >
                <Share aria-hidden />
                Share…
              </Button>
            ) : null}
          </div>
        </div>
      </Field>
    </div>
  )
}

type ClientScope = { mode: "all" | "some"; clientIds: string[] }

/**
 * Which clients a member or viewer will see once they accept: all of them
 * (the default, and it includes clients added later) or only the ticked
 * ones. Stored on the invitation and applied as listing access when it is
 * accepted (lib/server/provisioning.ts). Clients with no listings can't be
 * ticked: scoped to nothing, they would see everything.
 */
function InviteClientScope({
  value,
  onChange,
  error,
  disabled,
}: {
  value: ClientScope
  onChange: (next: ClientScope) => void
  error: string | null
  disabled?: boolean
}) {
  const clients = useClients({ enabled: value.mode === "some" })
  const status: QueryStatus = queryStatus(clients)
  return (
    <AccessScopeForm
      noun={{ one: "client", many: "clients" }}
      legend="Client access"
      legendVisible
      split
      mode={value.mode}
      onModeChange={(mode) => onChange({ ...value, mode })}
      allOption={{
        title: "All clients",
        description: "Including clients added later.",
      }}
      someOption={{
        title: "Only these clients",
        description: "They see only the clients you tick.",
      }}
      items={(clients.data?.items ?? []).map((item) => {
        const checked = value.clientIds.includes(item.id)
        return {
          id: item.id,
          name: item.name,
          description:
            item.locationCount === 0
              ? "No listings yet"
              : `${item.locationCount} ${item.locationCount === 1 ? "listing" : "listings"}`,
          checked,
          disabled: item.locationCount === 0 && !checked,
        }
      })}
      itemsStatus={status}
      itemsError={clients.error}
      onRetryItems={() => void clients.refetch()}
      emptyMessage="There are no clients yet. Invite them for all clients, or add a client first."
      onToggle={(id, next) =>
        onChange({
          ...value,
          clientIds: next
            ? [...value.clientIds, id]
            : value.clientIds.filter((clientId) => clientId !== id),
        })
      }
      disabled={disabled}
      error={error}
    />
  )
}

/** "All clients", or up to two client names and a count. */
function scopeSummary(
  names: string[] | null | undefined,
  business = false
): string {
  if (business) return "All locations"
  if (!names) return "All clients"
  if (names.length <= 2) return names.join(", ")
  return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`
}

/**
 * Invite someone: an email, a role chosen from the role cards, and whether
 * they may publish. Creating an invitation makes a link to share and, when
 * the organisation emails its invitations, sends it to them as well; nothing
 * changes until they accept. Values survive a refused submit; a server
 * refusal about the address is shown on the address.
 *
 * `layout="card"` draws the form as a white card with its own submit
 * (setup); `layout="dialog"` lays it out as a dialog body and footer.
 */
function InviteForm({
  actorRole,
  layout,
  onDirtyChange,
}: {
  actorRole: MemberRole
  layout: "card" | "dialog"
  /** Told whether the form holds entries a dismissal would lose. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const client = useQueryClient()
  const business = useWorkspaceMode() === "business"
  const emailDelivery = useEmailDelivery()
  const ids = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("member")
  const [canPublish, setCanPublish] = useState(false)
  const [scope, setScope] = useState<ClientScope>({
    mode: "all",
    clientIds: [],
  })
  const [scopeError, setScopeError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<{
    email: string
    role: MemberRole
    url: string
    access: string
    delivery?: InvitationDelivery | null
  } | null>(null)
  // Owners and admins see every client whatever the invitation says. A
  // business invites for every location and narrows access afterwards, from
  // Location access on the member's row.
  const scoped = !business && (role === "member" || role === "viewer")
  // Entries not yet sent. Once the link is on screen there is nothing to
  // lose: the invitation is in the list with its own Copy link.
  const dirty =
    !created &&
    (email.trim() !== "" ||
      role !== "member" ||
      canPublish ||
      scope.mode !== "all" ||
      scope.clientIds.length > 0)
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const create = useMutation({
    mutationFn: (input: {
      email: string
      role: MemberRole
      canPublish: boolean
      clientIds?: string[]
    }) => createInvitation(input),
    onSuccess: async (result, input) => {
      setEmail("")
      setRole("member")
      setCanPublish(false)
      setScope({ mode: "all", clientIds: [] })
      setScopeError(null)
      setEmailError(null)
      setFormError(null)
      setCreated({
        email: input.email,
        role: input.role,
        url: result.inviteUrl,
        access: scopeSummary(
          result.invitation.clients?.map((client) => client.name),
          business
        ),
        // Present only when the server queued an email for it.
        ...(result.invitation.delivery !== undefined
          ? { delivery: result.invitation.delivery }
          : {}),
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
    const scopedIds =
      scoped && scope.mode === "some" ? scope.clientIds : undefined
    if (scopedIds && scopedIds.length === 0) {
      // An empty scope would mean every client; make them say so instead.
      setScopeError("Tick at least one client, or choose All clients.")
      return
    }
    setScopeError(null)
    const parsed = invitationFormSchema.safeParse({
      email: email.trim(),
      role,
      canPublish: role === "viewer" ? false : canPublish,
      ...(scopedIds ? { clientIds: scopedIds } : {}),
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
          {...inputHints.email}
          // Someone else's address: never offer the operator's own.
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
          <span id={publishHintId} className="text-ui text-ink-muted">
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
      {scoped ? (
        <InviteClientScope
          value={scope}
          onChange={(next) => {
            setScope(next)
            if (scopeError) setScopeError(null)
          }}
          error={scopeError}
          disabled={create.isPending}
        />
      ) : null}
      {business && (role === "member" || role === "viewer") ? (
        <p className="text-ui text-ink-muted" data-slot="invite-location-note">
          They’ll see all your locations, including ones you add later. After
          they join, narrow this from Location access on their row in Team.
        </p>
      ) : null}
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
    <Button
      type="submit"
      pending={create.isPending}
      pendingLabel={emailDelivery ? "Sending…" : "Creating…"}
    >
      {emailDelivery ? "Send invitation" : "Create invite link"}
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
      <div
        className={cardClassName({
          pad: true,
          className: "flex flex-col gap-4",
        })}
      >
        <CreatedInvite created={created} />
        <div className="flex justify-end">{inviteAnother}</div>
      </div>
    )
  }

  if (layout === "dialog") {
    return (
      <form noValidate onSubmit={onSubmit} className="contents">
        <DialogBody>{fields}</DialogBody>
        <DialogFooter>{submit}</DialogFooter>
      </form>
    )
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className={cardClassName({ pad: true, className: "flex flex-col gap-4" })}
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
  const emailDelivery = useEmailDelivery()
  // Typed-in entries guard an accidental dismissal (a swipe down on the
  // phone's sheet, a scrim tap); cleared whenever the dialog closes.
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
        title: "Discard this invitation?",
        description:
          "What you entered hasn’t been sent. Nobody is invited until you create the invitation.",
      }}
    >
      <DialogContent size="wide" className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            {emailDelivery
              ? "We email them a link to join, and you get a copy of it too. Nothing changes until they accept, and the link expires after 7 days."
              : "You get a link to send them; NabaPresence doesn’t email it. Nothing changes until they accept, and the link expires after 7 days."}
          </DialogDescription>
        </DialogHeader>
        {/* Stays open on success to show the link; Done closes it. */}
        <InviteForm
          actorRole={actorRole}
          layout="dialog"
          onDirtyChange={setDirty}
        />
      </DialogContent>
    </Dialog>
  )
}

const EXPIRED_REASON = "This link has expired. Revoke it and invite them again."

/**
 * One invitation's actions: Copy link (and Resend, when the organisation
 * emails its invitations) stay in view; Share link and Revoke sit in the
 * row's menu, which is an action sheet on a phone. Every target is 44px on a
 * touch screen.
 */
function InvitationActions({
  invitation,
  expired,
  emailDelivery,
  resending,
  revoking,
  onResend,
  onRevoke,
}: {
  invitation: Invitation
  expired: boolean
  emailDelivery: boolean
  resending: boolean
  revoking: boolean
  onResend: () => void
  onRevoke: () => void
}) {
  const toast = useToastManager()
  const url = invitation.inviteUrl
  const canShare = useCanShareLink(url ?? "")
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5 @max-3xl/table:flex @max-3xl/table:justify-start">
      {emailDelivery ? (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Resend invitation email to ${invitation.email}`}
          aria-describedby={`invite-delivery-${invitation.id}`}
          pending={resending}
          pendingLabel="Sending…"
          disabledReason={
            expired
              ? EXPIRED_REASON
              : !canResendInvitation(invitation.delivery)
                ? "An email for this invitation is still being sent."
                : undefined
          }
          onClick={onResend}
        >
          <Send aria-hidden />
          Resend
        </Button>
      ) : null}
      {url ? (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Copy invite link for ${invitation.email}`}
          disabledReason={expired ? EXPIRED_REASON : undefined}
          onClick={() => void copyInviteLink(url, toast)}
        >
          <Copy aria-hidden />
          Copy link
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${invitation.email}`}
            />
          }
        >
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          title={invitation.email}
          className="data-[presentation=popover]:max-w-80"
        >
          {url && canShare ? (
            <>
              <DropdownMenuItem
                disabledReason={expired ? EXPIRED_REASON : undefined}
                onClick={() => void shareInviteLink(url, toast)}
              >
                <Share aria-hidden />
                Share invite link…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            disabled={revoking}
            aria-label={`Revoke invitation for ${invitation.email}`}
            onClick={onRevoke}
          >
            <Trash2 aria-hidden />
            Revoke invitation…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

/**
 * The invitations nobody has accepted yet (reference `invites-table`):
 * address and when it was created, role, publishing, whether the link still
 * works, and Copy link / Revoke. When the organisation emails its
 * invitations, each row also says where its email stands and offers Resend
 * (not while a send is queued, nor once the link has expired). Copy link
 * stays the fallback whatever the email did. Record cards below 48rem of the table's width.
 */
export function InvitationsList({ onInvite }: { onInvite?: () => void }) {
  const query = useInvitations()
  const business = useWorkspaceMode() === "business"
  const emailDelivery = query.data?.emailDelivery === true
  const client = useQueryClient()
  const toast = useToastManager()
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null)
  const resend = useResendInvitation()
  const resendInvitation = (invitation: Invitation) =>
    resend.mutate(invitation.id, {
      onSuccess: ({ delivery }) => {
        const view = describeInvitationDelivery(delivery, formatDay)
        toast.add({
          title:
            delivery.status === "sent"
              ? `Invitation emailed to ${invitation.email}`
              : delivery.status === "pending"
                ? `Invitation email to ${invitation.email} is queued`
                : `The email to ${invitation.email} wasn’t sent`,
          description: view.detail,
          type:
            delivery.status === "sent" || delivery.status === "pending"
              ? "success"
              : "error",
        })
      },
      onError: (error) =>
        toast.add({ title: describeActionError(error), type: "error" }),
    })

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

  const status = queryStatus(query, { isEmpty: query.data?.items.length === 0 })
  if (status !== "ready" || !query.data) {
    return (
      <QueryStates
        status={status}
        pending={
          <Skeleton
            aria-busy="true"
            className="h-24 w-full rounded-(--np-radius-card)"
          />
        }
        error={{ title: "We couldn’t load invitations", cause: query.error }}
        onRetry={() => void query.refetch()}
        empty={
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
        }
      />
    )
  }

  return (
    <>
      <Table
        surface
        responsive
        aria-label="Pending invitations"
        className={TEAM_LIST_TABLE_CLASS}
        containerClassName={TEAM_LIST_CONTAINER_CLASS}
      >
        <TableHeader>
          <TableRow>
            <TableHead>Invited</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Publishing</TableHead>
            <TableHead>Status</TableHead>
            {emailDelivery ? <TableHead>Email</TableHead> : null}
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
                <TableCell label="Invited" priority="primary">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar>
                      <AvatarFallback>
                        <Mail aria-hidden className="size-4" />
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-body font-semibold [overflow-wrap:anywhere] text-ink desk:text-ui">
                        {invitation.email}
                      </span>
                      <span className="text-caption text-ink-muted">
                        Created {formatDay(invitation.createdAt)}
                      </span>
                    </span>
                  </span>
                </TableCell>
                <TableCell label="Role">
                  <span className="flex flex-col items-start gap-1">
                    <RoleChip role={invitation.role} />
                    <span className="text-caption text-ink-muted">
                      {invitation.role === "owner" ||
                      invitation.role === "admin"
                        ? business
                          ? "All locations"
                          : "All clients"
                        : scopeSummary(
                            invitation.clients?.map((client) => client.name),
                            business
                          )}
                    </span>
                  </span>
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
                {emailDelivery ? (
                  <TableCell label="Email">
                    <DeliveryState
                      delivery={invitation.delivery}
                      id={`invite-delivery-${invitation.id}`}
                    />
                  </TableCell>
                ) : null}
                <TableCell actions className="text-right">
                  <InvitationActions
                    invitation={invitation}
                    expired={expired}
                    emailDelivery={emailDelivery}
                    resending={
                      resend.isPending && resend.variables === invitation.id
                    }
                    revoking={revoke.isPending}
                    onResend={() => resendInvitation(invitation)}
                    onRevoke={() => setRevokeTarget(invitation)}
                  />
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
