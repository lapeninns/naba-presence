import { after } from "next/server"

import {
  isLikelyBot,
  parseReviewLinkSource,
  REVIEW_LINK_SOURCE_PARAM,
} from "@/lib/domain/review-link"
import {
  recordReviewLinkClick,
  resolveReviewLink,
  takeReviewLinkBudget,
} from "@/lib/server/review-links"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The public review link: /r/<code> (lib/server/review-links.ts). No
 * session. A live code counts one open and redirects (302) to the venue's
 * Google review form. An unknown, rotated-away or switched-off code gets
 * one plain page that names no venue, so a probe learns nothing. Opens are
 * budgeted per client IP: over budget, a live code still redirects (a pub's
 * guests share one Wi-Fi address) but the open isn't counted, and anything
 * else gets a "try again" page. The proxy (proxy.ts) does no auth, and this
 * route sits outside the dashboard's session check.
 */

/** Never cached, never indexed, and no referrer passed on to Google. */
const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
}

function plainPage(
  status: number,
  title: string,
  body: string,
  headers: Record<string, string> = {}
): Response {
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>:root{color-scheme:light dark;}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;margin:0;padding:15vh 1.5rem;}main{max-width:32rem;margin:0 auto;}h1{font-size:1.375rem;margin:0 0 .5rem;}p{margin:0;}</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${body}</p>
</main>
</body>
</html>
`
  return new Response(html, {
    status,
    headers: {
      ...HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      ...headers,
    },
  })
}

const notAvailable = () =>
  plainPage(
    404,
    "This review link isn’t working any more",
    "It may have been replaced or switched off. If you’re at the venue, ask a member of staff for the current one, or find the venue on Google Maps to leave a review."
  )

const tryAgain = (retryAfterSeconds: number) =>
  plainPage(
    429,
    "Please try again in a few minutes",
    "Lots of people on this network have opened review links recently. Wait a few minutes and try again, or switch to mobile data.",
    { "Retry-After": String(retryAfterSeconds) }
  )

/** Asked for ahead of a visit (link prefetch, speculation rules): not an open. */
function isPrefetch(request: Request): boolean {
  const purpose =
    request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? ""
  return (
    /prefetch|prerender/i.test(purpose) ||
    request.headers.get("next-router-prefetch") !== null
  )
}

async function open(
  request: Request,
  params: Promise<{ code: string }>,
  count: boolean
): Promise<Response> {
  const budget = await takeReviewLinkBudget(request)
  const { code } = await params
  const link = await resolveReviewLink(code)
  if (!link) {
    return budget.allowed ? notAvailable() : tryAgain(budget.retryAfterSeconds)
  }
  // Counted after the response, so the guest never waits on it. Link
  // previews, crawlers and prefetches are not guests; the user agent is
  // read here and never stored.
  if (
    count &&
    budget.allowed &&
    !isPrefetch(request) &&
    !isLikelyBot(request.headers.get("user-agent"))
  ) {
    const source = parseReviewLinkSource(
      new URL(request.url).searchParams.get(REVIEW_LINK_SOURCE_PARAM)
    )
    after(() => recordReviewLinkClick(link, source))
  }
  return new Response(null, {
    status: 302,
    headers: { ...HEADERS, Location: link.targetUri },
  })
}

export function GET(
  request: Request,
  context: { params: Promise<{ code: string }> }
): Promise<Response> {
  return open(request, context.params, true)
}

/** A HEAD (a link checker, a preview) resolves the same way but counts nothing. */
export function HEAD(
  request: Request,
  context: { params: Promise<{ code: string }> }
): Promise<Response> {
  return open(request, context.params, false)
}
