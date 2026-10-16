import { createHash, randomBytes, randomUUID } from "node:crypto"

import postgres from "postgres"

import {
  createTestTenant,
  destroyTenants,
  destroyUsers,
  seedInvitation,
  seedMember,
} from "../../integration/helpers/tenant"

type Role = "owner" | "admin" | "member" | "viewer"

/**
 * A throwaway agency tenant for the Team page, signed in as its owner.
 *
 * /team reads its members and pending invitations on the server (P20,
 * SET-22) and hydrates them into the page, so a browser-side
 * `page.route("/api/members")` stub no longer decides what the first render
 * shows. A spec that needs particular people seeds them here instead; its
 * stubs still answer the browser's own requests (a role change, the refetch
 * after one). Member emails carry a per-tenant `{id}`, because
 * app_user.email is unique and the same spec runs in several projects at
 * once.
 */
export async function seedTeamTenant(options: {
  members?: {
    displayName: string
    /** `{id}` is replaced by 8 characters unique to this tenant. */
    email: string
    role: Role
    canPublish: boolean
  }[]
  invitations?: {
    email: string
    role: Role
    canPublish: boolean
    createdAt: Date
    expiresAt: Date
  }[]
  settings?: { approvalRequired: boolean; rawContentRetentionDays: number }
}) {
  const url = process.env.DIRECT_DATABASE_URL
  if (!url) {
    throw new Error(
      "DIRECT_DATABASE_URL (the harness database) is required to seed the Team tenant."
    )
  }
  const admin = postgres(url, { max: 1 })
  const tenant = await createTestTenant(admin)
  const suffix = randomUUID().slice(0, 8)
  const userIds: string[] = []
  try {
    const members = []
    for (const member of options.members ?? []) {
      const email = member.email.replace("{id}", suffix)
      const userId = await seedMember(admin, {
        organisationId: tenant.organisationId,
        email,
        displayName: member.displayName,
        role: member.role,
        canPublish: member.canPublish,
      })
      userIds.push(userId)
      members.push({ ...member, userId, email })
    }
    const invitationTokens: string[] = []
    for (const invitation of options.invitations ?? []) {
      const { token } = await seedInvitation(admin, {
        organisationId: tenant.organisationId,
        invitedBy: tenant.userId,
        ...invitation,
      })
      invitationTokens.push(token)
    }
    if (options.settings) {
      await admin`
        update organisation
        set
          approval_required = ${options.settings.approvalRequired},
          raw_content_retention_days = ${options.settings.rawContentRetentionDays}
        where id = ${tenant.organisationId}
      `
    }
    return {
      cookie: tenant.cookie,
      ownerUserId: tenant.userId,
      ownerEmail: tenant.email,
      members,
      /** Each seeded invitation's token, the secret its invite link carries. */
      invitationTokens,
      /**
       * Another person in this tenant with a signed-in session, as the
       * application stores one.
       */
      async signIn(
        role: Role,
        canPublish = role === "owner" || role === "admin"
      ) {
        const userId = await seedMember(admin, {
          organisationId: tenant.organisationId,
          email: `harness-${randomUUID().slice(0, 8)}@nabapresence.test`,
          displayName: `Harness ${role}`,
          role,
          canPublish,
        })
        userIds.push(userId)
        const token = randomBytes(32).toString("base64url")
        const hash = createHash("sha256").update(token).digest("hex")
        await admin`
          insert into app_session (token_hash, user_id, organisation_id, expires_at)
          values (${hash}, ${userId}, ${tenant.organisationId}, now() + interval '1 hour')
        `
        return { userId, cookie: `naba_session=${token}` }
      },
      /** A role change as PATCH /api/members writes it, for someone with no assigned listings. */
      async setRole(userId: string, role: Role, canPublish: boolean) {
        await admin`
          update member
          set
            role = ${role},
            can_publish = ${canPublish},
            location_scope = case
              when ${role} in ('owner', 'admin') then 'all'
              else member.location_scope
            end
          where organisation_id = ${tenant.organisationId} and user_id = ${userId}
        `
      },
      async destroy() {
        try {
          await destroyTenants(admin, [tenant.organisationId])
        } finally {
          try {
            await destroyUsers(admin, userIds)
          } finally {
            await admin.end()
          }
        }
      },
    }
  } catch (error) {
    await destroyTenants(admin, [tenant.organisationId]).catch(() => {})
    await destroyUsers(admin, userIds).catch(() => {})
    await admin.end()
    throw error
  }
}
