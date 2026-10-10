import "server-only"

import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"

export function requireOpenRegistration() {
  if (getServerEnv().REGISTRATION_MODE === "invite_only") {
    throw new ApiError(
      403,
      "registration_closed",
      "NabaPresence is available by invitation during the pilot."
    )
  }
}

/** Validate admission before the auth provider creates a user or sends mail.
 * Acceptance still rechecks the invitation under a row lock after the person
 * confirms their email. Possessing a token cannot enrol a different address.
 */
export async function requireRegistrationInvitation(
  email: string,
  inviteToken?: string
) {
  if (!inviteToken) {
    requireOpenRegistration()
    return
  }
  const [invitation] = await getDatabase()<
    { email: string; expiresAt: Date; acceptedAt: Date | null }[]
  >`
    select email, expires_at as "expiresAt", accepted_at as "acceptedAt"
    from lookup_invitation(${sha256(inviteToken)})
  `
  if (!invitation || invitation.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(
      410,
      "invitation_expired",
      "This invitation is invalid or expired."
    )
  }
  if (invitation.acceptedAt) {
    throw new ApiError(
      409,
      "invitation_already_used",
      "This invitation has already been accepted."
    )
  }
  if (invitation.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new ApiError(
      403,
      "invitation_email_mismatch",
      "Use the email address that received this invitation."
    )
  }
}
