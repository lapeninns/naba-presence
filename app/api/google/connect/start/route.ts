import { cookies } from "next/headers"

import {
  connectStartBodySchema,
  type ConnectStartResponse,
} from "@/lib/contracts/connections"
import { randomToken, signOAuthState } from "@/lib/server/crypto"
import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleOAuthUrl,
  pkceChallenge,
} from "@/lib/server/google"
import { safeOAuthReturn } from "@/lib/server/oauth-return"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  roles: ["owner", "admin"],
  body: connectStartBodySchema,
  handler: async ({ session, body, tenant }) => {
    // Read through RLS: another organisation's connection id yields no hint,
    // not its owner's email.
    const reconnect = body.reconnectConnectionId
      ? await tenant(async (sql) => {
          const [row] = await sql<{ id: string; email: string | null }[]>`
            select id::text as id, google_email as email
            from google_connection
            where id = ${body.reconnectConnectionId!}
          `
          return row ?? null
        })
      : null
    const loginHint = reconnect?.email ?? null
    const nonce = randomToken(24)
    const verifier = randomToken(64)
    const statePayload = Buffer.from(
      JSON.stringify({
        nonce,
        verifier,
        organisationId: session.organisationId,
        userId: session.userId,
        // Both survive the round trip inside the SIGNED state, not the query
        // string: the callback has to trust them, and a Google redirect is
        // attacker-influenced.
        clientId: body.clientId,
        returnTo: safeOAuthReturn(body.returnTo),
        // Only an id this organisation can see (read through RLS above).
        reconnectConnectionId: reconnect?.id,
        expiresAt: Date.now() + 10 * 60 * 1000,
      })
    ).toString("base64url")
    const signedState = `${statePayload}.${signOAuthState(statePayload)}`
    ;(await cookies()).set("naba_google_oauth", signedState, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: GOOGLE_OAUTH_CALLBACK_PATH,
      maxAge: 10 * 60,
    })
    return {
      authorizationUrl: googleOAuthUrl({
        state: nonce,
        codeChallenge: pkceChallenge(verifier),
        loginHint,
      }),
    } satisfies ConnectStartResponse
  },
})
