import { NextResponse } from "next/server"

import { secretEqual } from "@/lib/server/crypto"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError } from "@/lib/server/http"
import { runDueJobs } from "@/lib/server/jobs"
import { withAdvisoryLock } from "@/lib/server/leases"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const cronToken = request.headers
      .get("authorization")
      ?.replace(/^Bearer /, "")
    if (!secretEqual(cronToken, getServerEnv().CRON_SECRET)) {
      throw new ApiError(
        401,
        "authentication_required",
        "Authentication required."
      )
    }
    return NextResponse.json(
      await withAdvisoryLock("naba:jobs", () =>
        runDueJobs({ budgetMs: 45_000 })
      )
    )
  } catch (error) {
    return apiError(error)
  }
}
