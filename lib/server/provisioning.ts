import "server-only"

import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
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
