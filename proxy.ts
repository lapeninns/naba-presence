import { NextResponse, type NextRequest } from "next/server"

import { REQUEST_PATH_HEADER } from "@/lib/api/next-path"

/**
 * Hands the requested path to server components. A layout cannot read the
 * URL it renders under, so the dashboard layout could only send a signed-out
 * visitor to a bare `/sign-in` and the deep link they followed was lost. The
 * path travels as a REQUEST header (never a response header), and the layout
 * still runs it through `sanitiseNextPath` before it becomes `?next=`.
 *
 * This does no auth: the session check stays in the layout, where it reads
 * the database.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.set(
    REQUEST_PATH_HEADER,
    request.nextUrl.pathname + request.nextUrl.search
  )
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: [
    // Pages only: API routes, Next internals and files with an extension
    // never render the dashboard layout.
    "/((?!api/|_next/|.*\\.[\\w]+$).*)",
  ],
}
