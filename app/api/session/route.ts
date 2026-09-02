import { NextResponse } from "next/server"

import { route } from "@/lib/server/route"
import {
  clearSession,
  ensureDevelopmentSession,
  getSession,
  isLocalBootstrapEnabled,
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
    return { session }
  },
})

// Public: signing out must succeed whether or not a valid session exists.
export const DELETE = route({
  auth: "public",
  handler: async () => {
    await clearSession()
    return new NextResponse(null, { status: 204 })
  },
})
