import { NextResponse, type NextRequest } from "next/server"

import { REQUEST_PATH_HEADER } from "@/lib/api/next-path"
import {
  INTERNAL_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/domain/request-id"

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
  const requestId = crypto.randomUUID()
  headers.set(INTERNAL_REQUEST_ID_HEADER, requestId)
  headers.set(
    REQUEST_PATH_HEADER,
    request.nextUrl.pathname + request.nextUrl.search
  )
  const response = NextResponse.next({ request: { headers } })
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

export const config = {
  matcher: [
    // Keep API requests out of proxy so Next does not buffer their bodies.
    // The route wrapper creates and propagates an independent ID for them.
    "/((?!api/|_next/|.*\\.[\\w]+$).*)",
  ],
}
