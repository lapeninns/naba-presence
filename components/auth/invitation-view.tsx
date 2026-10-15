"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Building2,
  CalendarClock,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import Link from "next/link"

import { AuthCard } from "@/components/auth/auth-card"
import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { InvitationActions } from "@/components/auth/invitation-actions"
import { SignInForm, type SignInMode } from "@/components/auth/sign-in-form"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row"
import { Skeleton } from "@/components/ui/skeleton"
import * as authApi from "@/lib/api/auth"
import { authErrorMessage, confirmStatusMessage } from "@/lib/api/auth-errors"
import { ApiClientError } from "@/lib/api/client"
import type { MemberRole } from "@/lib/contracts/members"
import { formatDateTime } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import { roleLabel } from "@/lib/settings/member-roles"
import { invitationRoleSummary } from "@/lib/settings/roles"

// Shared across the three dead-end branches below (not-found, already
// accepted, expired) so the copy/href can't drift out of sync between them.
// The only way on from a dead end, so it is the full-width primary action.
function GoToSignInLink() {
  return (
    <Link
      href="/sign-in"
      className={buttonVariants({ size: "lg", block: true })}
    >
      Go to sign in
    </Link>
  )
}

/**
 * The expiry in the visitor's own time zone ("22 Oct, 14:05"). Safe only
 * because the lookup runs in the browser: a server prefetch of this query
 * would render it in the server's zone and mismatch on hydration.
 */
function expiryLabel(expiresAt: string): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return formatDateTime(expiresAt, timeZone)
}

/**
 * Who is inviting whom: the organisation, the address the invitation was
 * sent to, the role it grants with a line on what that role can do, and
 * when the link stops working (D8), plus the account the visitor is
 * currently signed in with when there is one. Facts to read, not fields to
 * fill, so static settings rows (no link, no button): on a phone they sit
 * straight on the card, at the desk in a bordered card. Each row keeps its
 * words-first order, the field's name over its value, and the value wraps
 * so a long address never spills past a 320px screen. Only what the lookup
 * actually returns is shown: the response carries no inviter name, so none
 * is invented (and no inviter avatar either).
 */
function InvitationDetails({
  organisationName,
  email,
  role,
  expiresAt,
  viewerEmail,
}: {
  organisationName: string
  email: string
  role: MemberRole
  expiresAt: string
  viewerEmail?: string
}) {
  const rows: {
    icon: typeof Building2
    label: string
    value: string
    detail?: string
  }[] = [
    { icon: Building2, label: "Organisation", value: organisationName },
    { icon: Mail, label: "Sent to", value: email },
    {
      icon: ShieldCheck,
      label: "Role",
      value: roleLabel(role),
      detail: invitationRoleSummary(role),
    },
    {
      icon: CalendarClock,
      label: "Link expires",
      value: expiryLabel(expiresAt),
    },
    ...(viewerEmail
      ? [{ icon: UserRound, label: "Signed in as", value: viewerEmail }]
      : []),
  ]
  return (
    <SettingsGroup aria-label="Invitation details" card>
      {rows.map((row) => (
        <SettingsRow
          key={row.label}
          icon={<row.icon />}
          label={
            <span className="text-caption text-ink-muted">{row.label}</span>
          }
          description={
            <>
              <span className="text-body font-medium [overflow-wrap:anywhere] text-ink">
                {row.value}
              </span>
              {row.detail ? (
                <span className="block text-caption text-ink-muted">
                  {row.detail}
                </span>
              ) : null}
            </>
          }
        />
      ))}
    </SettingsGroup>
  )
}

function InvitationView({
  token,
  viewer,
  initialMode = "create-account",
}: {
  token: string
  viewer: { displayName: string; email: string } | null
  /**
   * `sign-in` after a visitor signed out of a different account to get
   * here: the invited address usually has an account of its own.
   */
  initialMode?: SignInMode
}) {
  // retry: false - the shared query client defaults to retry: 1, which would
  // double the wait before every error branch below renders (and briefly
  // hide the 404-vs-500 distinction behind a silent retry).
  const query = useQuery({
    queryKey: queryKeys.invitation(token),
    queryFn: () => authApi.lookupInvitation(token),
    retry: false,
  })

  if (query.isPending) {
    return (
      <AuthCard
        aside="invite"
        eyebrow="Invitation"
        title="Checking your invitation"
      >
        {/* The skeleton takes the shape of what arrives: the details list
            (four rows), then the form's fields and its button. */}
        <div aria-busy="true" className="flex flex-col gap-6">
          <Skeleton className="h-60 w-full rounded-lg" />
          <Skeleton className="h-(--np-field-h) w-full rounded-md" />
          <Skeleton className="h-(--np-field-h) w-full rounded-md" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      </AuthCard>
    )
  }

  if (query.isError) {
    // A missing invitation is a dead end with one way out (sign in on your
    // own). Every other failure (network trouble, a 500, ...) is transient,
    // so it gets a retry instead of being routed away.
    const notFound =
      query.error instanceof ApiClientError &&
      query.error.code === "invitation_not_found"
    return (
      <AuthCard aside="invite" eyebrow="Invitation" title="Accept invitation">
        <AuthErrorAlert message={authErrorMessage(query.error, "invitation")} />
        {notFound ? (
          <GoToSignInLink />
        ) : (
          <Button type="button" size="lg" block onClick={() => query.refetch()}>
            Try again
          </Button>
        )}
      </AuthCard>
    )
  }

  const { data } = query

  if (data.accepted) {
    return (
      <AuthCard
        aside="invite"
        eyebrow="Invitation"
        title={`Join ${data.organisationName}`}
      >
        <Alert variant="info">
          <AlertTitle>You have already accepted this invitation.</AlertTitle>
        </Alert>
        <GoToSignInLink />
      </AuthCard>
    )
  }

  if (data.expired) {
    return (
      <AuthCard
        aside="invite"
        eyebrow="Invitation"
        title={`Join ${data.organisationName}`}
      >
        <AuthErrorAlert
          message={confirmStatusMessage("invitation_expired", "invitation")}
        />
        <GoToSignInLink />
      </AuthCard>
    )
  }

  if (viewer === null) {
    return (
      <AuthCard
        aside="invite"
        eyebrow="Invitation"
        title={`Join ${data.organisationName}`}
        description={
          initialMode === "sign-in"
            ? `Sign in with the invited address and you will be able to work on what ${data.organisationName} has given you access to.`
            : `Set a password and you will be able to work on what ${data.organisationName} has given you access to.`
        }
      >
        <InvitationDetails
          organisationName={data.organisationName}
          email={data.email}
          role={data.role}
          expiresAt={data.expiresAt}
        />
        <SignInForm
          initialMode={initialMode}
          inviteToken={token}
          invitedEmail={data.email}
        />
      </AuthCard>
    )
  }

  return (
    <AuthCard
      eyebrow="Invitation"
      title={`Join ${data.organisationName}`}
      description={
        viewer.email.trim().toLowerCase() === data.email.trim().toLowerCase()
          ? `Accepting adds ${data.organisationName} to the account you are already signed in with.`
          : "This invitation belongs to a different account."
      }
    >
      <InvitationDetails
        organisationName={data.organisationName}
        email={data.email}
        role={data.role}
        expiresAt={data.expiresAt}
        viewerEmail={viewer.email}
      />
      <InvitationActions
        viewer={viewer}
        invitedEmail={data.email}
        token={token}
      />
    </AuthCard>
  )
}

export { InvitationView }
