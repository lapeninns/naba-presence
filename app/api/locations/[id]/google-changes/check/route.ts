import { z } from "zod"

import type { GoogleChangeCheckResponse } from "@/lib/contracts/google-change-watch"
import type { WatchedField } from "@/lib/domain/google-change-watch-vocabulary"
import { withTenant } from "@/lib/server/db"
import {
  readChanges,
  watchGoogleChanges,
} from "@/lib/server/google-change-watch"
import { getHoursState } from "@/lib/server/hours"
import { readProfileStateBundle } from "@/lib/server/profile"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * "Check Google now": reads the profile and hours from Google (which records
 * their observations, as the presence sweep does), then runs the watch on
 * what was recorded.
 */
export const POST = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: z.object({ id: z.uuid() }),
  limits: ({ session }) => ({
    scope: "bulk_request",
    user: session.userId,
    organisation: session.organisationId,
  }),
  handler: async ({ session, params }) => {
    const locationId = params.id
    const reads = await Promise.allSettled([
      readProfileStateBundle(session, locationId, { refresh: true }),
      getHoursState(session, locationId, { refresh: true }),
    ])
    // A read that failed leaves its fields unobserved; with neither read,
    // there is nothing to check and the first error answers.
    if (reads.every((read) => read.status === "rejected")) {
      throw (reads[0] as PromiseRejectedResult).reason
    }
    const outcome = await watchGoogleChanges({
      organisationId: session.organisationId,
      locationId,
    })
    const changes = await withTenant(session.organisationId, (sql) =>
      readChanges(sql, session, locationId)
    )
    const unchecked: WatchedField[] = [
      ...(reads[0].status === "rejected"
        ? ([
            "name",
            "description",
            "phone",
            "website",
            "primaryCategory",
          ] as const)
        : []),
      ...(reads[1].status === "rejected"
        ? (["regularHours", "specialHours"] as const)
        : []),
    ]
    return {
      ...changes,
      found: outcome.found,
      unchecked,
    } satisfies GoogleChangeCheckResponse
  },
})
