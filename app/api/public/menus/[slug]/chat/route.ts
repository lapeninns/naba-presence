import { NextResponse } from "next/server"
import { z } from "zod"

import { answerMenuQuestion } from "@/lib/server/ai"
import { ApiError, apiError } from "@/lib/server/http"
import { getPublicMenuBySlug } from "@/lib/server/menus"

export const runtime = "nodejs"
export const maxDuration = 30

const inputSchema = z.object({
  message: z.string().trim().min(1).max(600),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2000),
      })
    )
    .max(8)
    .default([]),
})

const rateLimits = new Map<string, { count: number; resetAt: number }>()

function enforceRateLimit(request: Request, slug: string) {
  const now = Date.now()
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const key = `${slug}:${forwarded ?? "unknown"}`
  const current = rateLimits.get(key)
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + 60_000 })
    return
  }
  if (current.count >= 15) {
    throw new ApiError(
      429,
      "menu_chat_rate_limited",
      "Please wait a moment before asking another question."
    )
  }
  current.count += 1
  if (rateLimits.size > 5_000) {
    for (const [entryKey, value] of rateLimits) {
      if (value.resetAt <= now) rateLimits.delete(entryKey)
    }
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params
    enforceRateLimit(request, slug)
    const input = inputSchema.parse(await request.json())
    const menu = await getPublicMenuBySlug(slug)
    if (!menu) {
      throw new ApiError(404, "menu_not_found", "This menu is not available.")
    }
    const answer = await answerMenuQuestion({
      menu,
      message: input.message,
      history: input.history,
    })
    return NextResponse.json(answer)
  } catch (error) {
    return apiError(error)
  }
}
