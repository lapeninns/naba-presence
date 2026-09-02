import { NextResponse } from "next/server"
import { z } from "zod"

import { emailSchema } from "@/lib/domain/auth"
import { getServerEnv } from "@/lib/server/env"
import { resendConfirmationEmail } from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const resendSchema = z.object({ email: emailSchema })

export const POST = route({
  auth: "public",
  body: resendSchema,
  handler: async ({ request, body }) => {
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    const confirmationUrl = new URL("/auth/confirm", baseUrl)
    confirmationUrl.searchParams.set("flow", "signup")
    await resendConfirmationEmail(body.email, confirmationUrl.toString())
    return NextResponse.json({ accepted: true }, { status: 202 })
  },
})
