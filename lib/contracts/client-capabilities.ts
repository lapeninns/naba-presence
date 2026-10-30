/**
 * What a client build can read, sent with the requests whose answers grow.
 * Client-safe and free of zod: the shell's poll imports it on every page.
 *
 * During a deployment, browsers still running the previous build keep
 * calling the new server, and that build checks every answer against its own
 * contract. A response that names something the old contract does not know
 * fails the whole read (`malformed_response`). So a server sends an addition
 * only to a client that says it can read it, and answers everyone else with
 * the shape they already know.
 *
 *   notification-kinds-2   the approval notification kinds
 *                          (`approval_requested`, `reply_sent_back`, 0149)
 *                          in the notification list, the shell's poll and
 *                          notification preferences.
 *   notification-kinds-3   the topic alert (`review_topic_negative`, S3)
 *                          and the Google change watch kind
 *                          (`listing_google_changed`, 0155) in the same
 *                          three answers.
 */
export const CLIENT_CAPABILITIES_HEADER = "x-naba-capabilities"

export const CLIENT_CAPABILITIES = [
  "notification-kinds-2",
  "notification-kinds-3",
] as const
export type ClientCapability = (typeof CLIENT_CAPABILITIES)[number]

/** The header this build sends: every capability it has. */
export const clientCapabilityHeaders = (): Record<string, string> => ({
  [CLIENT_CAPABILITIES_HEADER]: CLIENT_CAPABILITIES.join(","),
})

/** Whether the request came from a build that can read `capability`. */
export function requestHasCapability(
  request: Pick<Request, "headers">,
  capability: ClientCapability
): boolean {
  return (request.headers.get(CLIENT_CAPABILITIES_HEADER) ?? "")
    .split(",")
    .some((value) => value.trim() === capability)
}
