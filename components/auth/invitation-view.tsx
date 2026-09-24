"use client"

import { useQuery } from "@tanstack/react-query"
import { Building2, Mail, UserRound } from "lucide-react"

import { AuthCard } from "@/components/auth/auth-card"
import { AuthErrorAlert } from "@/components/auth/auth-error-alert"
import { AuthLink } from "@/components/auth/auth-link"
import { InvitationActions } from "@/components/auth/invitation-actions"
import { SignInForm, type SignInMode } from "@/components/auth/sign-in-form"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import * as authApi from "@/lib/api/auth"
import { authErrorMessage, confirmStatusMessage } from "@/lib/api/auth-errors"
import { ApiClientError } from "@/lib/api/client"
import { queryKeys } from "@/lib/queries/keys"

// Shared across the three dead-end branches below (not-found, already
// accepted, expired) so the copy/href can't drift out of sync between them.
function GoToSignInLink() {
  return <AuthLink href="/sign-in">Go to sign in</AuthLink>
}

/**
 * Who is inviting whom: the organisation and the address the invitation
 * was sent to, plus the account the visitor is currently signed in with
 * when there is one. Facts to read, not fields to fill, so a bordered card
 * of rows. Only what the lookup actually returns is shown: the response
 * carries no inviter name, so none is invented.
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
    <section aria-label="Invitation details">
      <ul className="flex flex-col rounded-lg border border-line bg-surface">
        {rows.map((row) => (
          <li
            key={row.label}
            className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 border-t border-line px-3.5 py-3 first:border-t-0"
          >
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-md bg-surface-alt text-ink-secondary"
            >
              <row.icon className="size-4" strokeWidth={1.75} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-caption text-ink-muted">{row.label}</span>
              <span className="text-ui font-semibold [overflow-wrap:anywhere] text-ink">
                {row.value}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
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
        <div aria-busy="true" className="flex flex-col gap-5">
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
          <Button
            type="button"
            size="lg"
            className="h-11 w-full"
            onClick={() => query.refetch()}
          >
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
            ? "Sign in with the invited address and you will be able to work on the clients this agency has given you."
            : "Set a password and you will be able to work on the clients this agency has given you."
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
          ? "Accepting adds this agency to the account you are already signed in with."
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
