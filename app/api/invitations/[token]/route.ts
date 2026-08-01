import { NextResponse } from "next/server"

import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { ApiError, apiError } from "@/lib/server/http"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const [invitation] = await getDatabase()<
      {
        organisationName: string
        email: string
        expiresAt: Date
        acceptedAt: Date | null
      }[]
    >`
      select
        organisation_name as "organisationName",
        email,
        expires_at as "expiresAt",
        accepted_at as "acceptedAt"
      from lookup_invitation(${sha256(token)})
    `
    if (!invitation) {
      throw new ApiError(
        404,
        "invitation_not_found",
        "Invitation not found."
      )
    }
    const accepted = invitation.acceptedAt !== null
    return NextResponse.json({
      organisationName: invitation.organisationName,
      email: invitation.email,
      accepted,
      expired: !accepted && invitation.expiresAt.getTime() <= Date.now(),
    })
  } catch (error) {
    return apiError(error)
  }
}
