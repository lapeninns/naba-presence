import { randomUUID } from "node:crypto"

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
    for (const invitation of options.invitations ?? []) {
      await seedInvitation(admin, {
        organisationId: tenant.organisationId,
        invitedBy: tenant.userId,
        ...invitation,
      })
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
