import "server-only"

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
import { grantClientListings } from "@/lib/server/client-access"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { createSession } from "@/lib/server/session-store"

export type GoogleProfile = {
  sub: string
  email?: string
  name?: string
  email_verified?: boolean
}

export type AuthenticatedIdentity = {
  provider: string
  subject: string
  email: string
  displayName: string
  emailVerified: boolean
}

function mapIdentityProvisioningError(error: unknown): never {
  if (
    error instanceof Error &&
    error.message.includes("unverified_email_conflict")
  ) {
    throw new ApiError(
      403,
      "unverified_google_email",
      "Google has not verified this email address."
    )
  }
  throw error
}

function mapAuthenticatedIdentityError(error: unknown): never {
  if (error instanceof ApiError) throw error
  if (error instanceof Error) {
    if (error.message.includes("unverified_auth_email")) {
      throw new ApiError(
        403,
        "email_not_verified",
        "Confirm your email address before signing in."
      )
    }
    if (error.message.includes("auth_identity_conflict")) {
      throw new ApiError(
        409,
        "auth_identity_conflict",
        "This email is already linked to another account."
      )
    }
  }
  throw error
}

async function provisionAuthenticatedUser(
  sql: TransactionSql,
  identity: AuthenticatedIdentity
) {
  const [user] = await sql<
    {
      id: string
      defaultOrganisationId: string | null
      emailChangeHeld: boolean
    }[]
  >`
    select
      id::text as id,
      default_organisation_id::text as "defaultOrganisationId",
      email_change_held as "emailChangeHeld"
    from provision_authenticated_user(
      ${identity.provider},
      ${identity.subject},
      ${identity.email},
      ${identity.displayName},
      ${identity.emailVerified}
    )
  `
  if (!user) {
    throw new ApiError(
      500,
      "identity_provisioning_failed",
      "The account could not be prepared."
    )
  }
  return user
}

export async function provisionAuthenticatedOwner(
  identity: AuthenticatedIdentity
) {
  return getDatabase()
    .begin(async (sql) => {
      const slugBase = identity.email
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40)
      const user = await provisionAuthenticatedUser(sql, identity)
      await sql`select set_config('app.user_id', ${user.id}, true)`
      let organisationId = user.defaultOrganisationId
      if (organisationId) {
        // default_organisation_id is not cleared when a membership is
        // removed, and a session minted into an organisation the user has
        // left is rejected by lookupSession's member join on the very next
        // request - an unbreakable login loop. list_user_organisations is
        // SECURITY DEFINER: it reads memberships across tenants, which is the
        // only way to tell a stale pointer from a live one before any
        // organisation context has been chosen.
        const memberships = await sql<{ organisationId: string }[]>`
          select organisation_id::text as "organisationId"
          from list_user_organisations(${user.id})
        `
        const stale = !memberships.some(
          (membership) => membership.organisationId === organisationId
        )
        if (stale) {
          organisationId = memberships[0]?.organisationId ?? null
          if (organisationId) {
            await sql`
              update app_user
              set default_organisation_id = ${organisationId}
              where id = ${user.id}
            `
          }
        }
      }
      if (!organisationId) {
        organisationId = crypto.randomUUID()
        await sql`
          select set_config(
            'app.organisation_id',
            ${organisationId},
            true
          )
        `
        // The slug is keyed on the new organisation id, not on the identity.
        // The stale-pointer repair above reaches this branch for a user whose
        // ORIGINAL organisation already holds the identity-derived slug, so
        // organisation_slug_key would turn the login loop into a permanent
        // 500 instead of fixing it.
        await sql`
          insert into organisation (id, slug, name)
          values (
            ${organisationId},
            ${`${slugBase || "organisation"}-${organisationId.slice(0, 8)}`},
            ${`${identity.displayName}'s organisation`}
          )
        `
        await sql`
          insert into member (
            organisation_id,
            user_id,
            role,
            can_publish
          )
          values (${organisationId}, ${user.id}, 'owner', true)
        `
        await sql`
          update app_user
          set default_organisation_id = ${organisationId}
          where id = ${user.id}
        `
      } else {
        await sql`
          select set_config('app.organisation_id', ${organisationId}, true)
        `
      }
      const token = await createSession(sql, user.id, organisationId)
      return {
        organisationId,
        userId: user.id,
        token,
        emailChangeHeld: user.emailChangeHeld,
      }
    })
    .catch(mapAuthenticatedIdentityError)
}

/**
 * Turns a client-scoped invitation into location_member rows, inside the
 * acceptance transaction, for BOTH acceptance paths below. Returns how many
 * listings were granted (0 for an unscoped invitation).
 *
 * Only a membership this acceptance created is scoped: the do-nothing insert
 * above never rewrites an existing membership, and adding rows to one would
 * narrow someone the invitation was never about. A scoped invitation whose
 * clients no longer hold any listing is REFUSED: accepted with no rows, the
 * invitee would see every client, the opposite of what was asked for.
 */
async function applyInvitationScope(
  sql: TransactionSql,
  input: {
    organisationId: string
    userId: string
    joined: boolean
    pending: { role: string; canPublish: boolean; clientIds: string[] | null }
  }
): Promise<number> {
  const { pending } = input
  if (!input.joined || !pending.clientIds || pending.clientIds.length === 0) {
    return 0
  }
  if (pending.role !== "member" && pending.role !== "viewer") return 0
  const granted = await grantClientListings(sql, {
    organisationId: input.organisationId,
    userId: input.userId,
    clientIds: pending.clientIds,
    canPublish: pending.role === "member" && pending.canPublish,
  })
  if (granted.length === 0) {
    throw new ApiError(
      409,
      "invitation_scope_empty",
      "The clients this invitation was for have no listings any more. Ask for a new invitation."
    )
  }
  return granted.length
}

export async function provisionAuthenticatedMember(
  identity: AuthenticatedIdentity,
  invitation: {
    id: string
    organisationId: string
    role: string
    canPublish: boolean
  },
  requestId: string
): Promise<{
  organisationId: string
  userId: string
  token: string
  emailChangeHeld: boolean
}> {
  return getDatabase()
    .begin(async (sql) => {
      await sql`
        select set_config(
          'app.organisation_id',
          ${invitation.organisationId},
          true
        )
      `
      const [pending] = await sql<
        {
          id: string
          email: string
          role: string
          canPublish: boolean
          expiresAt: Date
          acceptedAt: Date | null
          clientIds: string[] | null
        }[]
      >`
        select
          id::text as id,
          email,
          role,
          can_publish as "canPublish",
          expires_at as "expiresAt",
          accepted_at as "acceptedAt",
          client_ids::text[] as "clientIds"
        from invitation
        where id = ${invitation.id}
          and organisation_id = ${invitation.organisationId}
        for update
      `
      if (!pending) {
        throw new ApiError(404, "invitation_not_found", "Invitation not found.")
      }
      if (pending.acceptedAt) {
        throw new ApiError(
          409,
          "invitation_already_used",
          "This invitation has already been accepted."
        )
      }
      if (pending.expiresAt.getTime() <= Date.now()) {
        throw new ApiError(
          410,
          "invitation_expired",
          "This invitation has expired."
        )
      }
      if (
        pending.role !== invitation.role ||
        pending.canPublish !== invitation.canPublish
      ) {
        throw new ApiError(
          409,
          "invitation_changed",
          "The invitation details changed."
        )
      }
      if (
        pending.email.trim().toLowerCase() !==
        identity.email.trim().toLowerCase()
      ) {
        throw new ApiError(
          403,
          "invitation_email_mismatch",
          "Sign in with the email address that received this invitation."
        )
      }
      const user = await provisionAuthenticatedUser(sql, identity)
      await sql`select set_config('app.user_id', ${user.id}, true)`
      // do nothing, never do update: acceptance may create a membership but
      // must never rewrite one. The owner_role_required and last_owner guards
      // live in PATCH /api/members, and an upsert here bypassed both from
      // inside authentication, where raising 409 would fail the sign-in
      // itself. Re-inviting the sole owner as a viewer used to leave the
      // organisation permanently ownerless.
      const joined = await sql`
        insert into member (
          organisation_id,
          user_id,
          role,
          can_publish
        )
        values (
          ${invitation.organisationId},
          ${user.id},
          ${pending.role},
          ${pending.canPublish}
        )
        on conflict (organisation_id, user_id) do nothing
        returning user_id
      `
      const scopedListings = await applyInvitationScope(sql, {
        organisationId: invitation.organisationId,
        userId: user.id,
        joined: joined.length > 0,
        pending,
      })
      if (!user.defaultOrganisationId) {
        await sql`
          update app_user
          set default_organisation_id = ${invitation.organisationId}
          where id = ${user.id}
        `
      }
      await sql`
        update invitation
        set accepted_at = now(), accepted_by = ${user.id}
        where id = ${pending.id}
      `
      await writeAudit(sql, {
        organisationId: invitation.organisationId,
        actorUserId: user.id,
        action: "member.invitation_accepted",
        subjectType: "invitation",
        subjectId: pending.id,
        requestId,
        metadata: {
          invitedEmail: pending.email,
          authenticatedEmail: identity.email,
          provider: identity.provider,
          role: pending.role,
          canPublish: pending.canPublish,
          clientIds: pending.clientIds,
          scopedListings,
        },
      })
      const token = await createSession(sql, user.id, invitation.organisationId)
      return {
        organisationId: invitation.organisationId,
        userId: user.id,
        token,
        emailChangeHeld: user.emailChangeHeld,
      }
    })
    .catch(mapAuthenticatedIdentityError)
}

/**
 * Accepts an invitation for a visitor who is ALREADY signed in, so matching
 * the invited address no longer costs a sign-out and a password. Mirrors the
 * checks in `provisionAuthenticatedMember` (row lock, accepted/expired,
 * changed-details and email match) against the session user's stored email,
 * which is the address they last authenticated with. A support session is
 * refused: it acts as the customer and must not join organisations for them.
 *
 * Returns a fresh session token in the invitation's organisation; the caller
 * swaps the cookie and retires the old session, as `/api/session/switch`
 * does.
 */
export async function acceptInvitationForSessionUser(
  user: { userId: string; email: string; supportActor?: string | null },
  invitation: {
    id: string
    organisationId: string
    role: string
    canPublish: boolean
  },
  requestId: string
): Promise<{ organisationId: string; userId: string; token: string }> {
  if (user.supportActor) {
    throw new ApiError(
      403,
      "support_session_forbidden",
      "A support session cannot accept invitations."
    )
  }
  return getDatabase().begin(async (sql) => {
    await sql`
      select set_config('app.organisation_id', ${invitation.organisationId}, true)
    `
    const [pending] = await sql<
      {
        id: string
        email: string
        role: string
        canPublish: boolean
        expiresAt: Date
        acceptedAt: Date | null
        clientIds: string[] | null
      }[]
    >`
      select
        id::text as id,
        email,
        role,
        can_publish as "canPublish",
        expires_at as "expiresAt",
        accepted_at as "acceptedAt",
        client_ids::text[] as "clientIds"
      from invitation
      where id = ${invitation.id}
        and organisation_id = ${invitation.organisationId}
      for update
    `
    if (!pending) {
      throw new ApiError(404, "invitation_not_found", "Invitation not found.")
    }
    if (pending.acceptedAt) {
      throw new ApiError(
        409,
        "invitation_already_used",
        "This invitation has already been accepted."
      )
    }
    if (pending.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(
        410,
        "invitation_expired",
        "This invitation has expired."
      )
    }
    if (
      pending.role !== invitation.role ||
      pending.canPublish !== invitation.canPublish
    ) {
      throw new ApiError(
        409,
        "invitation_changed",
        "The invitation details changed."
      )
    }
    if (
      pending.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
    ) {
      throw new ApiError(
        403,
        "invitation_email_mismatch",
        "Sign in with the email address that received this invitation."
      )
    }
    await sql`select set_config('app.user_id', ${user.userId}, true)`
    // Same do-nothing rule as provisionAuthenticatedMember: acceptance may
    // create a membership but never rewrite an existing one.
    const joined = await sql`
      insert into member (organisation_id, user_id, role, can_publish)
      values (
        ${invitation.organisationId},
        ${user.userId},
        ${pending.role},
        ${pending.canPublish}
      )
      on conflict (organisation_id, user_id) do nothing
      returning user_id
    `
    const scopedListings = await applyInvitationScope(sql, {
      organisationId: invitation.organisationId,
      userId: user.userId,
      joined: joined.length > 0,
      pending,
    })
    await sql`
      update invitation
      set accepted_at = now(), accepted_by = ${user.userId}
      where id = ${pending.id}
    `
    await writeAudit(sql, {
      organisationId: invitation.organisationId,
      actorUserId: user.userId,
      action: "member.invitation_accepted",
      subjectType: "invitation",
      subjectId: pending.id,
      requestId,
      metadata: {
        invitedEmail: pending.email,
        authenticatedEmail: user.email,
        provider: "session",
        role: pending.role,
        canPublish: pending.canPublish,
        clientIds: pending.clientIds,
        scopedListings,
      },
    })
    const token = await createSession(
      sql,
      user.userId,
      invitation.organisationId
    )
    return {
      organisationId: invitation.organisationId,
      userId: user.userId,
      token,
    }
  })
}

/**
 * Google sign-in twin of `provisionAuthenticatedOwner`, kept only because
 * `tests/integration/provisioning.test.ts` and
 * `tests/integration/routes/identity-hardening.test.ts` still drive the
 * identity-conflict paths through it. No route reaches it:
 * `app/api/auth/callback/google/route.ts` re-exports the Google *connection*
 * callback, not a sign-in. Its member counterpart has been deleted; do not
 * add a second acceptance path here.
 */
export async function provisionOwner(profile: GoogleProfile) {
  return getDatabase()
    .begin(async (sql) => {
      const slugBase = (profile.email?.split("@")[0] ?? profile.sub)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40)
      const [user] = await sql<
        {
          id: string
          default_organisation_id: string | null
          email_change_held: boolean
        }[]
      >`
      select
        id::text as id,
        default_organisation_id::text as default_organisation_id,
        email_change_held
      from provision_google_user(
        ${profile.email ?? `${profile.sub}@google.invalid`},
        ${profile.name ?? profile.email ?? "Google user"},
        ${profile.sub},
        ${profile.email_verified === true}
      )
    `
      await sql`select set_config('app.user_id', ${user.id}, true)`
      let organisationId = user.default_organisation_id
      if (!organisationId) {
        // Establish the tenant context BEFORE the RLS-sensitive insert so the
        // organisation_isolation USING clause makes the row visible.
        organisationId = crypto.randomUUID()
        await sql`
        select set_config(
          'app.organisation_id',
          ${organisationId},
          true
        )
      `
        await sql`
        insert into organisation (id, slug, name)
        values (
          ${organisationId},
          ${`${slugBase || "organisation"}-${sha256(profile.sub).slice(0, 8)}`},
          ${profile.name ? `${profile.name}'s organisation` : "My organisation"}
        )
      `
        await sql`
        insert into member (
          organisation_id,
          user_id,
          role,
          can_publish
        )
        values (${organisationId}, ${user.id}, 'owner', true)
      `
        await sql`
        update app_user
        set default_organisation_id = ${organisationId}
        where id = ${user.id}
      `
      } else {
        await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
      }
      if (user.email_change_held) {
        await writeAudit(sql, {
          organisationId,
          actorUserId: user.id,
          action: "identity.email_change_held",
          subjectType: "app_user",
          subjectId: user.id,
          requestId: crypto.randomUUID(),
          metadata: {
            requestedEmail: profile.email ?? null,
            googleSubject: profile.sub,
          },
        })
      }
      const token = await createSession(sql, user.id, organisationId)
      return { organisationId, userId: user.id, token }
    })
    .catch(mapIdentityProvisioningError)
}
