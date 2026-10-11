import { NextResponse } from "next/server"

import { readiness } from "@/lib/server/readiness"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Readiness for an external probe (scripts/ops/readiness-probe.mjs): 200 when
 * ready or degraded, 503 when not ready, never cached. Platform-level and
 * bounded (lib/server/readiness.ts); it carries no tenant data.
 *
 * Authenticated with the cron bearer token rather than a token of its own:
 * every caller that may run the scheduled ticks may also ask whether they are
 * running, and a second secret would be one more thing to rotate and forget
 * on the one endpoint that has to work when the rest has gone quiet.
 */
export const GET = route({
  auth: "cron",
  handler: async () => {
    const body = await readiness()
    return NextResponse.json(body, {
      status: body.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    })
  },
})
