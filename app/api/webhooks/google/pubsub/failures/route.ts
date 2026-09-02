import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ tenant }) => {
    const items = await tenant((sql) => sql`
      select
        id::text as id,
        event_type as "eventType",
        status,
        retry_count as "retryCount",
        next_attempt_at as "nextAttemptAt",
        last_error_code as "lastErrorCode",
        received_at as "receivedAt"
      from processed_webhook_event
      where status in ('failed', 'dead')
      order by received_at desc, id desc
      limit 100
    `)
    return { items }
  },
})
