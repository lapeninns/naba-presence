import { NextResponse } from "next/server"

import { apiError } from "@/lib/server/http"
import { pendingProposalCounts } from "@/lib/server/import-review"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({
      counts: await pendingProposalCounts({ session }),
    })
  } catch (error) {
    return apiError(error)
  }
}
