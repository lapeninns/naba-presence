import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

import { randomToken, signValue } from "@/lib/server/crypto"
import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleOAuthUrl,
  pkceChallenge,
} from "@/lib/server/google"
import { apiError } from "@/lib/server/http"
import { getSession } from "@/lib/server/session"

export const runtime = "nodejs"

const inputSchema = z.object({
  inviteToken: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(
      await request.json().catch(() => ({}))
    )
    const session = await getSession()
    const nonce = randomToken(24)
    const verifier = randomToken(64)
    const statePayload = Buffer.from(
      JSON.stringify({
        nonce,
        verifier,
        organisationId: session?.organisationId ?? null,
        userId: session?.userId ?? null,
        inviteToken: input.inviteToken ?? null,
        expiresAt: Date.now() + 10 * 60 * 1000,
      })
    ).toString("base64url")
    const signedState = `${statePayload}.${signValue(statePayload)}`
    ;(await cookies()).set("naba_google_oauth", signedState, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: GOOGLE_OAUTH_CALLBACK_PATH,
      maxAge: 10 * 60,
    })
    return NextResponse.json({
      authorizationUrl: googleOAuthUrl({
        state: nonce,
        codeChallenge: pkceChallenge(verifier),
      }),
    })
  } catch (error) {
    return apiError(error)
  }
}
