import "server-only"

import type { TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
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
      if (!organisationId) {
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
            ${`${slugBase || "organisation"}-${sha256(identity.subject).slice(0, 8)}`},
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

export async function provisionAuthenticatedMember(
  identity: AuthenticatedIdentity,
  invitation: {
    id: string
    organisationId: string
    role: string
    canPublish: boolean
  }
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
        }[]
      >`
        select
          id::text as id,
          email,
          role,
          can_publish as "canPublish",
          expires_at as "expiresAt",
          accepted_at as "acceptedAt"
        from invitation
        where id = ${invitation.id}
          and organisation_id = ${invitation.organisationId}
        for update
      `
      if (!pending) {
        throw new ApiError(
          404,
          "invitation_not_found",
          "Invitation not found."
        )
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
      await sql`
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
        on conflict (organisation_id, user_id) do update
        set
          role = excluded.role,
          can_publish = excluded.can_publish
      `
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
        requestId: crypto.randomUUID(),
        metadata: {
          invitedEmail: pending.email,
          authenticatedEmail: identity.email,
          provider: identity.provider,
          role: pending.role,
          canPublish: pending.canPublish,
        },
      })
      const token = await createSession(
        sql,
        user.id,
        invitation.organisationId
      )
      return {
        organisationId: invitation.organisationId,
        userId: user.id,
        token,
        emailChangeHeld: user.emailChangeHeld,
      }
    })
    .catch(mapAuthenticatedIdentityError)
}

export async function provisionOwner(profile: GoogleProfile) {
  return getDatabase().begin(async (sql) => {
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
  }).catch(mapIdentityProvisioningError)
}

export async function provisionMember(
  profile: GoogleProfile,
  invitation: {
    id: string
    organisationId: string
    role: string
    canPublish: boolean
  }
): Promise<{ organisationId: string; userId: string; token: string }> {
  return getDatabase().begin(async (sql) => {
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
      }[]
    >`
      select
        id::text as id,
        email,
        role,
        can_publish as "canPublish",
        expires_at as "expiresAt",
        accepted_at as "acceptedAt"
      from invitation
      where id = ${invitation.id}
        and organisation_id = ${invitation.organisationId}
      for update
    `
    if (!pending) {
      throw new ApiError(
        404,
        "invitation_not_found",
        "Invitation not found."
      )
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
      from provision_google_user(
        ${profile.email ?? `${profile.sub}@google.invalid`},
        ${profile.name ?? profile.email ?? "Google user"},
        ${profile.sub},
        ${profile.email_verified === true}
      )
    `
    await sql`select set_config('app.user_id', ${user.id}, true)`
    await sql`
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
      on conflict (organisation_id, user_id) do update
      set
        role = excluded.role,
        can_publish = excluded.can_publish
    `
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
      requestId: crypto.randomUUID(),
      metadata: {
        invitedEmail: pending.email,
        googleEmail: profile.email ?? null,
        emailChangeHeld: user.emailChangeHeld,
        role: pending.role,
        canPublish: pending.canPublish,
      },
    })
    const token = await createSession(
      sql,
      user.id,
      invitation.organisationId
    )
    return {
      organisationId: invitation.organisationId,
      userId: user.id,
      token,
    }
  }).catch(mapIdentityProvisioningError)
}
