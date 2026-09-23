import { NextResponse } from "next/server"

import { getServerEnv } from "@/lib/server/env"
import {
  applyRiscEvent,
  invalidRiscToken,
  verifyRiscToken,
} from "@/lib/server/google/risc"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Google Cross-Account Protection receiver. Google POSTs one security event
 * token per request (content type application/secevent+jwt). Answers 202
 * for a valid token -- including a replay, which changes nothing -- and 400
 * for anything that does not verify, as Google's RISC guide asks.
 *
 * Public by necessity: Google cannot hold a session. Authenticity is the
 * token's signature, issuer and audience (lib/server/google/risc.ts).
 * Receiving events also needs the stream registered with Google, which is an
 * operator step (docs/runbook.md, "RISC").
 */
export const POST = route({
  auth: "public",
  handler: async ({ request }) => {
    if (!getServerEnv().RISC_ENABLED) {
      throw new ApiError(404, "not_found", "Not found.")
    }
    const token = (await request.text()).trim()
    if (!token || token.split(".").length !== 3) throw invalidRiscToken()
    const payload = await verifyRiscToken(token)
    const outcome = await applyRiscEvent(payload)
    return NextResponse.json(
      { accepted: true, duplicate: outcome.duplicate },
      { status: 202 }
    )
  },
})
