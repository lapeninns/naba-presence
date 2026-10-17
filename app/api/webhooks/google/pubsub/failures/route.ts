import { loadWebhookFailures } from "@/lib/server/operations-health"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  roles: ["owner", "admin"],
  handler: ({ tenant }) => tenant(loadWebhookFailures),
})
