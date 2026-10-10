/**
 * Google Business Profile APIs that Google has switched off.
 *
 * - Business Calls API (`mybusinessbusinesscalls`): discontinued 2023-05-30.
 * - v4 `healthProviderAttributes` and `insuranceNetworks`: discontinued
 *   2024-07-01.
 * - Questions and answers (v4 `questions`/`answers` and the v1
 *   `mybusinessqanda` API): discontinued 2025-11-03.
 * - v4 `locations/{id}:associate` and `:clearLocationAssociation` (and the
 *   v1 Business Information equivalents): retired with the v4 location
 *   surface.
 * - v4 `locations:reportInsights` (2023-03-30) and
 *   `localPosts:reportInsights` (2023-02-20): replaced by the Business
 *   Profile Performance API.
 *
 * Still supported, and deliberately NOT matched here: lodging, the v4
 * healthcare `serviceList`, reviews, food menus, local posts, media (whose
 * body field `locationAssociation.category` is a different thing from the
 * retired `:associate` method), verifications, notifications and place
 * actions.
 *
 * Pure so the transport and its tests share one definition.
 */

export const GOOGLE_API_RETIRED_CODE = "google_api_retired" as const

export type RetiredGoogleApi =
  | "business_calls"
  | "health_provider_attributes"
  | "insurance_networks"
  | "questions_and_answers"
  | "location_association"
  | "location_insights"
  | "local_post_insights"

const RETIRED_HOSTS: ReadonlyMap<string, RetiredGoogleApi> = new Map([
  ["mybusinessbusinesscalls.googleapis.com", "business_calls"],
  ["mybusinessqanda.googleapis.com", "questions_and_answers"],
])

const V4_HOST = "mybusiness.googleapis.com"
const BUSINESS_INFORMATION_HOST = "mybusinessbusinessinformation.googleapis.com"

const RETIRED_V4_PATHS: ReadonlyArray<readonly [RegExp, RetiredGoogleApi]> = [
  [/\/healthProviderAttributes(?:\/|$)/, "health_provider_attributes"],
  [/\/insuranceNetworks(?:\/|$)/, "insurance_networks"],
  [/\/questions(?:[/:]|$)/, "questions_and_answers"],
  [/\/answers(?:[/:]|$)/, "questions_and_answers"],
  [
    /\/locations(?:\/[^/:]+)?:(?:associate|clearLocationAssociation)$/,
    "location_association",
  ],
  [/\/locations:reportInsights$/, "location_insights"],
  [/\/localPosts:reportInsights$/, "local_post_insights"],
]

/**
 * Which retired Google API a request URL addresses, or null when the URL is
 * for a supported (or unrelated) endpoint. Unparseable URLs return null and
 * are left for the transport to fail on as before.
 */
export function retiredGoogleApi(url: string): RetiredGoogleApi | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  const byHost = RETIRED_HOSTS.get(host)
  if (byHost) return byHost
  if (
    host === BUSINESS_INFORMATION_HOST &&
    /:(?:associate|clearLocationAssociation)$/.test(parsed.pathname)
  ) {
    return "location_association"
  }
  if (host !== V4_HOST || !parsed.pathname.startsWith("/v4/")) return null
  for (const [pattern, api] of RETIRED_V4_PATHS) {
    if (pattern.test(parsed.pathname)) return api
  }
  return null
}
