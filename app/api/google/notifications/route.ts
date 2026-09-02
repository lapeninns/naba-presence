import type { TransactionSql } from "postgres"
import { z } from "zod"

import { GOOGLE_NOTIFICATION_TYPES } from "@/lib/domain/google-contract"
import { writeAudit } from "@/lib/server/audit"
import {
  connectionAccessToken,
  getGoogleNotificationSetting,
  updateGoogleNotificationSetting,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const notificationSchema = z.object({
  accountId: z.uuid(),
  pubsubTopic: z
    .string()
    .regex(
      /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][\w.-]{2,254}$/
    )
    .or(z.literal("")),
  notificationTypes: z
    .array(z.enum(GOOGLE_NOTIFICATION_TYPES))
    .transform((items) => [...new Set(items)])
    .default([...GOOGLE_NOTIFICATION_TYPES]),
})

async function accountForNotifications(
  sql: TransactionSql,
  accountId: string
) {
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
  handler: async ({ query, tenant }) => {
    const { accountId } = query
    if (!accountId) {
      throw new ApiError(400, "account_required", "Google account is required.")
    }
    const setting = await tenant(async (sql) => {
      const account = await accountForNotifications(sql, accountId)
      const accessToken = await connectionAccessToken(
        sql,
        account.connection_id
      )
      return getGoogleNotificationSetting(
        accessToken,
        account.google_account_name,
        { connectionKey: account.connection_id }
      )
    })
    return { setting }
  },
})

export const PATCH = route({
  roles: ["owner", "admin"],
  body: notificationSchema,
  handler: async ({ session, body, requestId, clientRequestId, tenant }) => {
    const setting = await tenant(async (sql) => {
      const account = await accountForNotifications(sql, body.accountId)
      const accessToken = await connectionAccessToken(
        sql,
        account.connection_id
      )
      const updated = await updateGoogleNotificationSetting(
        accessToken,
        account.google_account_name,
        body.pubsubTopic,
        body.pubsubTopic ? body.notificationTypes : [],
        { connectionKey: account.connection_id }
      )
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
      return updated
    })
    return { setting }
  },
})
