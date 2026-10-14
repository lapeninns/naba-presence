import { NextResponse } from "next/server"
import { z } from "zod"

import { clientIpFromRequest, takeAbuseBudget } from "@/lib/server/abuse-limits"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, serverRequestId } from "@/lib/server/http"
import { verifyEmailToken } from "@/lib/server/password-auth"
import { assertSameOrigin } from "@/lib/server/route"

export const runtime = "nodejs"

const querySchema = z.object({
  token_hash: z.string().min(20),
  type: z.enum(["email", "recovery"]),
  inviteToken: z.string().min(1).optional(),
})

const formSchema = z.object({
  token_hash: z.string().min(20),
  type: z.literal("email"),
  inviteToken: z.string().min(1).optional(),
})

function baseUrlFor(request: Request) {
  return getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
}

/** Lands a failure on sign-in, with the error code as `status`. */
function signInError(baseUrl: string, error: unknown, status?: 303) {
  const signInUrl = new URL("/sign-in", baseUrl)
  signInUrl.searchParams.set("email", "error")
  signInUrl.searchParams.set(
    "status",
    error instanceof ApiError ? error.code : "invalid_email_link"
  )
  return NextResponse.redirect(signInUrl, status)
}

/**
 * The emailed link. It never consumes the one-time token: a mail scanner or
 * link preview that fetches it would burn the token, and a GET that signs
 * in lets another site sign a visitor into the sender's account (W6-05).
 * Confirmation goes to an interstitial whose button POSTs back here;
 * recovery already has one, the new-password form.
 */
export async function GET(request: Request) {
  const baseUrl = baseUrlFor(request)
  try {
    const url = new URL(request.url)
    const input = querySchema.parse({
      token_hash: url.searchParams.get("token_hash"),
      type: url.searchParams.get("type"),
      inviteToken: url.searchParams.get("inviteToken") ?? undefined,
    })
    const next = new URL(
      input.type === "recovery" ? "/reset-password" : "/confirm-email",
      baseUrl
    )
    next.searchParams.set("token_hash", input.token_hash)
    if (input.type === "email" && input.inviteToken) {
      next.searchParams.set("inviteToken", input.inviteToken)
    }
    return NextResponse.redirect(next)
  } catch (error) {
    return signInError(baseUrl, error)
  }
}

/** The interstitial's form: consumes the token and signs in. */
export async function POST(request: Request) {
  const rid = serverRequestId(request)
  const baseUrl = baseUrlFor(request)
  try {
    assertSameOrigin(request)
    // Per client IP, before any token is looked at; a refusal is an ApiError,
    // so it lands on sign-in with status=auth_rate_limited like any failure.
    await takeAbuseBudget("confirm_email", { ip: clientIpFromRequest(request) })
    const form = await request.formData().catch(() => new FormData())
    const field = (name: string) => {
      const value = form.get(name)
      return typeof value === "string" && value !== "" ? value : undefined
    }
    const input = formSchema.parse({
      token_hash: field("token_hash"),
      type: field("type"),
      inviteToken: field("inviteToken"),
    })
    const verified = await verifyEmailToken({
      tokenHash: input.token_hash,
      type: "email",
    })
    const result = await completeEmailAuthentication({
      identity: verified.identity,
      inviteToken: input.inviteToken,
      requestId: rid.id,
      clientRequestId: rid.clientId,
      authMethod: "email_link",
      provider: verified,
    })
    // An enrolled person confirming (or accepting an invitation by link)
    // finishes on the code screen; the ticket cookie is already set. 303 so
    // the browser follows with a GET.
    return NextResponse.redirect(
      new URL(result.mfaRequired ? "/sign-in/verify" : "/inbox", baseUrl),
      303
    )
  } catch (error) {
    return signInError(baseUrl, error, 303)
  }
}
