/**
 * Plain words for the Google OAuth callback's redirect status.
 *
 * The callback (`app/api/google/connect/callback`) appends `google=connected`
 * on success and `google=error&status=<http status>&rid=<request id>` on
 * failure. The status is the only detail it carries, so this maps the same
 * numbers the connections page does; the request id is shown as-is so it can
 * be quoted to support.
 */
export function describeGoogleConnectStatus(status: string | null): string {
  switch (status) {
    case "400":
      return "Google’s sign-in was cancelled or couldn’t be completed, so nothing was connected. Try again and choose Allow when Google asks."
    case "401":
      return "Your session expired during Google’s sign-in. Sign in again, then connect."
    case "403":
      return "You don’t have permission to connect Google for this agency."
    case "429":
      return "Google is limiting requests right now. Try again in a few minutes."
    default:
      return "Google didn’t answer, so nothing was connected. Try again shortly."
  }
}

/** The callback's parameters, which should not follow the operator between steps. */
export const GOOGLE_RETURN_PARAMS = ["google", "status", "rid"] as const
