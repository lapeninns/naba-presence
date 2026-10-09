/**
 * Why a Google connection needs reconnecting, in the terms the fix differs by.
 *
 * Google answers both a revoked grant and an expired one with the same
 * `invalid_grant`, so the connection's status alone cannot tell them apart.
 * `refresh_token_expires_at` can: Google sets it only for apps in "Testing"
 * publishing status, where every refresh token dies after seven days.
 */
export type ReconnectReason = "expired" | "revoked" | "permission_missing"

export function reconnectReason(
  connection: {
    status: string
    lastErrorCode: string | null
    refreshTokenExpiresAt?: string | null
  },
  now: number = Date.now()
): ReconnectReason {
  if (
    connection.lastErrorCode === "insufficient_scope" ||
    connection.lastErrorCode === "invalid_scope"
  ) {
    return "permission_missing"
  }
  if (
    connection.refreshTokenExpiresAt &&
    Date.parse(connection.refreshTokenExpiresAt) <= now
  ) {
    return "expired"
  }
  return connection.status === "revoked" ? "revoked" : "expired"
}
