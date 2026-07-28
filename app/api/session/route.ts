import { NextResponse } from "next/server"

import { apiError } from "@/lib/server/http"
import {
  clearSession,
  ensureDevelopmentSession,
  getSession,
  isLocalBootstrapEnabled,
} from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET() {
  try {
    const session =
      (await getSession()) ??
      (process.env.NODE_ENV !== "production" ||
      isLocalBootstrapEnabled()
        ? await ensureDevelopmentSession()
        : null)
    return NextResponse.json({ session })
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE() {
  try {
    await clearSession()
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return apiError(error)
  }
}
