import { NextResponse } from "next/server"

import type { SessionResponse } from "@/lib/contracts/session"
import { route } from "@/lib/server/route"
import {
  clearSession,
  ensureDevelopmentSession,
  getSession,
  isLocalBootstrapEnabled,
  revokeAllSessions,
} from "@/lib/server/session"

export const runtime = "nodejs"

// Public: this endpoint reports the current session (or null) and, outside
// production, bootstraps the local development session.
export const GET = route({
  auth: "public",
  handler: async () => {
    const session =
      process.env.NODE_ENV !== "production" || isLocalBootstrapEnabled()
        ? await ensureDevelopmentSession()
        : await getSession()
    return { session } satisfies SessionResponse
  },
})

// Public: signing out must succeed whether or not a valid session exists.
// `?scope=all` signs the person out everywhere (every device, every
// organisation); Google connections and background sync are untouched.
export const DELETE = route({
  auth: "public",
  query: (searchParams) => ({ everywhere: searchParams.get("scope") === "all" }),
  handler: async ({ query }) => {
    if (query.everywhere) await revokeAllSessions()
    else await clearSession()
    return new NextResponse(null, { status: 204 })
  },
})
