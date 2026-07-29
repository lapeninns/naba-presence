import "server-only"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { createSession } from "@/lib/server/session-store"

export type GoogleProfile = {
  sub: string
  email?: string
  name?: string
}

export async function provisionOwner(profile: GoogleProfile) {
  return getDatabase().begin(async (sql) => {
    const slugBase = (profile.email?.split("@")[0] ?? profile.sub)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40)
    const [user] = await sql<
      { id: string; default_organisation_id: string | null }[]
    >`
      select
        id::text as id,
        default_organisation_id::text as default_organisation_id
      from provision_google_user(
        ${profile.email ?? `${profile.sub}@google.invalid`},
        ${profile.name ?? profile.email ?? "Google user"},
        ${profile.sub}
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
    const token = await createSession(sql, user.id, organisationId)
    return { organisationId, userId: user.id, token }
  })
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
      { id: string; defaultOrganisationId: string | null }[]
    >`
      select
        id::text as id,
        default_organisation_id::text as "defaultOrganisationId"
      from provision_google_user(
        ${profile.email ?? `${profile.sub}@google.invalid`},
        ${profile.name ?? profile.email ?? "Google user"},
        ${profile.sub}
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
  })
}
