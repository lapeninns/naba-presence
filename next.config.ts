import type { NextConfig } from "next"

// A conservative CSP that locks down framing, object embedding, base-uri and
// form-action without breaking Next 16's inline bootstrap script or Tailwind's
// injected styles. `'unsafe-inline'` is retained deliberately for script/style
// (Next injects an inline runtime bootstrap and Tailwind injects inline style)
// — a nonce-based tightening is a documented follow-up. connect/font stay
// same-origin; img additionally allows data:/blob: (the privacy-export object
// URL + inlined assets) AND the Google media origins that serve review/photo
// thumbnails CLIENT-SIDE (thumbnail_url is stored verbatim from Google — see
// lib/server/media.ts:114, reviews.ts:241 — and rendered as `<img src>` in
// review-detail.tsx:80-81 and photos-tab.tsx:187; there is NO image proxy and
// no next.config images.remotePatterns). Omitting these origins ships broken
// thumbnails, and the a11y/other e2e fixtures use `media: []` so the CSP
// violation would NOT fire and the zero-console-error guard would go a FALSE
// green — hence the dedicated remote-thumbnail render test in Step 1b.
// Next's development bundle uses eval-based source maps for React debugging.
// Production bundles do not require eval, so keep it out of the production CSP.
const developmentEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Google-hosted review/photo thumbnails: lh3-6.googleusercontent.com, *.ggpht.com.
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.ggpht.com",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${developmentEval}`,
  "connect-src 'self'",
].join("; ")

/**
 * Retired routes whose destination is fixed. Bookmarks and old links exist,
 * and silently 404-ing them would be a worse answer than landing somewhere
 * sensible. Every entry here used to be a one-line `page.tsx` that threw a
 * `redirect()`; as config they cost no render and forward the query string
 * by default, which `/login`, `/reviews`, `/performance` and `/connections`
 * relied on.
 *
 * The flat single-business routes (`/profile`, `/photos`, `/posts`,
 * `/settings/listing`) are NOT here: where they land depends on how many
 * locations the session can see, so they stay as server pages at the app
 * root (see lib/server/flat-route-redirect.ts).
 */
export const RETIRED_ROUTES: { source: string; destination: string }[] = [
  // Home is gone: the Inbox is where the work is, so it is where a session
  // starts.
  { source: "/home", destination: "/inbox" },
  { source: "/overview", destination: "/inbox" },
  { source: "/reviews", destination: "/inbox" },
  // One hop, not two: /analytics used to bounce through /performance.
  { source: "/analytics", destination: "/reports" },
  { source: "/performance", destination: "/reports" },
  { source: "/login", destination: "/sign-in" },
  { source: "/connections", destination: "/settings/connections" },
  // Team became a primary destination; Listing administration lives with
  // the location it administers.
  { source: "/settings/team", destination: "/team" },
  // The location workspace's retired segments. Administration became
  // Access; Business info and Industry are sections of the profile editor;
  // Hours, Booking and Suggested updates are sections of the Listing scroll;
  // Performance is a report, on Reports.
  { source: "/locations/:id/administration", destination: "/locations/:id/access" },
  { source: "/locations/:id/business-information", destination: "/locations/:id" },
  { source: "/locations/:id/industry", destination: "/locations/:id" },
  { source: "/locations/:id/hours", destination: "/locations/:id#hours" },
  { source: "/locations/:id/booking", destination: "/locations/:id#booking" },
  { source: "/locations/:id/suggestions", destination: "/locations/:id#suggestions" },
  { source: "/locations/:id/performance", destination: "/reports?locationId=:id" },
]

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  async redirects() {
    return RETIRED_ROUTES.map((route) => ({ ...route, permanent: false }))
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ]
  },
}

export default nextConfig
