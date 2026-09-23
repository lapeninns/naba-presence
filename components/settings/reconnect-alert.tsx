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
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

/**
 * The page-level warning when a Google login has stopped working (reference
 * `reconnect-alert`): which login, which clients are paused, and Reconnect,
 * which explains what signing in again does before Google opens.
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
  if (broken.length === 0) return null
  const first = broken[0]
  const served = clientsByConnection?.get(first.id)
  const names = joinNames(served)
  const who = first.googleEmail ?? "one of your Google logins"
  return (
    <>
      <Alert variant="warning">
        <AlertTitle>Reconnect Google to keep syncing</AlertTitle>
        <AlertDescription>
          Google access for{" "}
          <span className="[overflow-wrap:anywhere]">{who}</span> has expired.{" "}
          {names
            ? `${names} ${served && served.length === 1 ? "is" : "are"} paused: no new reviews, and nothing can publish.`
            : "Reconnect to resume reviews and publishing."}
          {broken.length > 1
            ? ` ${broken.length - 1} more ${broken.length === 2 ? "login needs" : "logins need"} reconnecting too.`
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
