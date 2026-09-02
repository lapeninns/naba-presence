import type { TransactionSql } from "postgres"

import { notificationPatchSchema } from "@/lib/contracts/notifications"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase } from "@/lib/server/db"
import {
  connectionAccessToken,
  getGoogleNotificationSetting,
  updateGoogleNotificationSetting,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

async function accountForNotifications(sql: TransactionSql, accountId: string) {
  const [account] = await sql<
    { id: string; google_account_name: string; connection_id: string }[]
  >`
    select
      id::text as id,
      google_account_name,
      google_connection_id::text as connection_id
    from google_account
    where id = ${accountId}
      and is_active = true
    limit 1
  `
  if (!account) {
    throw new ApiError(
      404,
      "active_google_account_not_found",
      "Select an active Google account first."
    )
  }
  return account
}

export const GET = route({
  roles: ["owner", "admin"],
  query: (searchParams) => ({
    accountId: searchParams.get("account_id"),
  }),
  handler: async ({ session, query, tenant }) => {
    const { accountId } = query
    if (!accountId) {
      throw new ApiError(400, "account_required", "Google account is required.")
    }
    const account = await tenant((sql) =>
      accountForNotifications(sql, accountId)
    )
    // The token and the provider call both run above `tenant`: a refresh
    // failure commits reconnect state that this handler must not roll back.
    const accessToken = await connectionAccessToken(
      getDatabase(),
      session.organisationId,
      account.connection_id
    )
    const setting = await getGoogleNotificationSetting(
      accessToken,
      account.google_account_name,
      { connectionKey: account.connection_id }
    )
    return { setting }
  },
})

export const PATCH = route({
  roles: ["owner", "admin"],
  body: notificationPatchSchema,
  handler: async ({ session, body, requestId, clientRequestId, tenant }) => {
    const account = await tenant((sql) =>
      accountForNotifications(sql, body.accountId)
    )
    const accessToken = await connectionAccessToken(
      getDatabase(),
      session.organisationId,
      account.connection_id
    )
    const setting = await updateGoogleNotificationSetting(
      accessToken,
      account.google_account_name,
      body.pubsubTopic,
      body.pubsubTopic ? body.notificationTypes : [],
      { connectionKey: account.connection_id }
    )
    await tenant(async (sql) => {
      await sql`
        update google_connection
        set
          pubsub_topic = ${body.pubsubTopic || null},
          notifications_enabled = ${Boolean(body.pubsubTopic)},
          notification_types = ${body.pubsubTopic ? body.notificationTypes : []}
        where id = ${account.connection_id}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: body.pubsubTopic
          ? "google.notifications.enabled"
          : "google.notifications.disabled",
        subjectType: "google_account",
        subjectId: account.id,
        requestId,
        metadata: {
          notificationTypes: body.pubsubTopic ? body.notificationTypes : [],
          clientRequestId,
        },
      })
    })
    return { setting }
  },
})
