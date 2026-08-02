import { NextResponse } from "next/server"

import { settingsCapabilities } from "@/lib/server/capabilities"
import { apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({ capabilities: settingsCapabilities(session) })
  } catch (error) {
    return apiError(error)
  }
}
