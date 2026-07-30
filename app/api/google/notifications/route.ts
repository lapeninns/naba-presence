import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import {
  connectionAccessToken,
  getGoogleNotificationSetting,
  updateGoogleNotificationSetting,
} from "@/lib/server/google"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

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
})

async function accountForNotifications(
  sql: Parameters<Parameters<typeof withTenant>[1]>[0],
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

export async function GET(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const accountId = new URL(request.url).searchParams.get("account_id")
    if (!accountId) {
      throw new ApiError(400, "account_required", "Google account is required.")
    }
    const setting = await withTenant(session.organisationId, async (sql) => {
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
    return NextResponse.json({ setting })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = notificationSchema.parse(await request.json())
    const setting = await withTenant(session.organisationId, async (sql) => {
      const account = await accountForNotifications(sql, input.accountId)
      const accessToken = await connectionAccessToken(
        sql,
        account.connection_id
      )
      const updated = await updateGoogleNotificationSetting(
        accessToken,
        account.google_account_name,
        input.pubsubTopic,
        { connectionKey: account.connection_id }
      )
      await sql`
        update google_connection
        set
          pubsub_topic = ${input.pubsubTopic || null},
          notifications_enabled = ${Boolean(input.pubsubTopic)}
        where id = ${account.connection_id}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: input.pubsubTopic
          ? "google.notifications.enabled"
          : "google.notifications.disabled",
        subjectType: "google_account",
        subjectId: account.id,
        requestId: rid.id,
        metadata: {
          notificationTypes: input.pubsubTopic
            ? ["NEW_REVIEW", "UPDATED_REVIEW"]
            : [],
          clientRequestId: rid.clientId,
        },
      })
      return updated
    })
    return NextResponse.json({ setting })
  } catch (error) {
    return apiError(error)
  }
}
