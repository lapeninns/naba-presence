import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

// S3: whether the organisation has review topics on, so the Inbox offers
// its Topic filter only where reviews can carry topics.
export const GET = route({
  handler: ({ session, tenant }) =>
    tenant(async (sql) => ({
      enabled: await isOrgFeatureEnabled(
        sql,
        session.organisationId,
        "review_topics"
      ),
    })),
})
