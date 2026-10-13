"use client"

import { useQuery } from "@tanstack/react-query"
import { Building2, Mail, UserRound } from "lucide-react"
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
import { queryKeys } from "@/lib/queries/keys"

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
 * Who is inviting whom: the organisation and the address the invitation
 * was sent to, plus the account the visitor is currently signed in with
 * when there is one. Facts to read, not fields to fill, so static settings
 * rows (no link, no button): on a phone they sit straight on the card, at
 * the desk in a bordered card. Each row keeps its words-first order, the
 * field's name over its value, and the value wraps so a long address never
 * spills past a 320px screen. Only what the lookup actually returns is
 * shown: the response carries no inviter name, so none is invented (and no
 * inviter avatar either).
 */
function InvitationDetails({
  organisationName,
  email,
  viewerEmail,
}: {
  organisationName: string
  email: string
  viewerEmail?: string
}) {
  const rows = [
    { icon: Building2, label: "Organisation", value: organisationName },
    { icon: Mail, label: "Sent to", value: email },
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
            <span className="text-body font-medium [overflow-wrap:anywhere] text-ink">
              {row.value}
            </span>
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
        {/* The skeleton takes the shape of what arrives: the details list,
            then the form's two fields and its button. */}
        <div aria-busy="true" className="flex flex-col gap-6">
          <Skeleton className="h-32 w-full rounded-lg" />
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
        <AuthErrorAlert message={authErrorMessage(query.error)} />
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
        <AuthErrorAlert message={confirmStatusMessage("invitation_expired")} />
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
