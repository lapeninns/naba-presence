import { NextResponse } from "next/server"

import { listConnections } from "@/lib/server/connections"
import { apiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({ connections: await listConnections(session) })
  } catch (error) {
    return apiError(error)
  }
}
