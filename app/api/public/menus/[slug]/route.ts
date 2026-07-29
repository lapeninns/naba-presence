import { NextResponse } from "next/server"

import { getPublicMenuBySlug } from "@/lib/server/menus"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const menu = await getPublicMenuBySlug(slug)
  return menu
    ? NextResponse.json({ menu })
    : NextResponse.json(
        { error: "menu_not_found", message: "This menu is not available." },
        { status: 404 }
      )
}
