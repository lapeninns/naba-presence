"use client"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { reconnectReason, type ReconnectReason } from "@/lib/connections/reconnect-reason"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null
}

function describe(
  reason: ReconnectReason,
  account: string,
  expiredOn: string | null
): { title: string; description: string } {
  switch (reason) {
    case "permission_missing":
      return {
        title: "Business Profile permission missing",
        description: `${account} is connected without permission to manage Business Profiles. Reconnect and leave the Business Profile permission ticked on Google’s consent screen.`,
      }
    case "revoked":
      return {
        title: "Google access was revoked",
        description: `Google no longer accepts NabaPresence’s access for ${account}. Access may have been removed in the Google account’s security settings, or its password changed. Reconnect and allow access again to resume reviews and publishing.`,
      }
    case "expired":
      return {
        title: "Google sign-in expired",
        description: `The Google sign-in for ${account} expired${expiredOn ? ` on ${expiredOn}` : ""}. Reconnect to renew it; reviews and publishing are paused until you do.`,
      }
  }
}

export function ReconnectAlert() {
  const { query, connect } = useConnectionWorkspace()
  const broken = query.data?.connections.filter((connection) => connection.reconnectRequired) ?? []
  const first = broken[0]
  if (!first) return null
  const account = first.googleEmail ?? "a Google account"
  const { title, description } = describe(
    reconnectReason(first),
    account,
    formatDate(first.refreshTokenExpiresAt)
  )
  const others = broken.length - 1
  return (
    <Alert variant="warning">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {description}
        {others > 0
          ? ` ${others} other Google ${others === 1 ? "account needs" : "accounts need"} reconnecting too.`
          : ""}
      </AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          disabled={connect.isPending}
          onClick={() => connect.mutate({ reconnectConnectionId: first.id })}
        >
          Reconnect {first.googleEmail ?? ""}
        </Button>
      </AlertAction>
    </Alert>
  )
}
