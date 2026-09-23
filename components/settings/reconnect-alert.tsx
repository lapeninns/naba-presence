"use client"

import { useState } from "react"

import {
  joinNames,
  ReconnectDialog,
} from "@/components/settings/connection-card"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  reconnectReason,
  type ReconnectReason,
} from "@/lib/connections/reconnect-reason"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
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
        description: `Google no longer accepts NabaPresence’s access for ${account}. Access may have been removed in the Google account’s security settings, or its password changed. Reconnect and allow access again.`,
      }
    case "expired":
      return {
        title: "Google sign-in expired",
        description: `The Google sign-in for ${account} expired${expiredOn ? ` on ${expiredOn}` : ""}. Reconnect to renew it.`,
      }
  }
}

/**
 * The page-level warning when a Google login has stopped working (reference
 * `reconnect-alert`): why it stopped, in the terms the fix differs by
 * (expired, revoked, permission missing), which clients are paused, and
 * Reconnect, which explains what signing in again does before Google opens.
 */
export function ReconnectAlert({
  clientsByConnection,
}: {
  clientsByConnection?: ReadonlyMap<string, { id: string; name: string }[]>
} = {}) {
  const { query } = useConnectionWorkspace()
  const [open, setOpen] = useState(false)
  const broken =
    query.data?.connections.filter(
      (connection) => connection.reconnectRequired
    ) ?? []
  const first = broken[0]
  if (!first) return null
  const served = clientsByConnection?.get(first.id)
  const names = joinNames(served)
  const account = first.googleEmail ?? "one of your Google logins"
  const { title, description } = describe(
    reconnectReason(first),
    account,
    formatDate(first.refreshTokenExpiresAt)
  )
  const others = broken.length - 1
  return (
    <>
      <Alert variant="warning">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <span className="[overflow-wrap:anywhere]">{description}</span>{" "}
          {names
            ? `${names} ${served && served.length === 1 ? "is" : "are"} paused: no new reviews, and nothing can publish.`
            : "Reviews and publishing are paused until you do."}
          {others > 0
            ? ` ${others} other Google ${others === 1 ? "login needs" : "logins need"} reconnecting too.`
            : ""}
        </AlertDescription>
        <AlertActions>
          <Button size="sm" onClick={() => setOpen(true)}>
            Reconnect
          </Button>
        </AlertActions>
      </Alert>
      <ReconnectDialog
        connection={first}
        served={served}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
