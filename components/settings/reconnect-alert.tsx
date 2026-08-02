"use client"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"

export function ReconnectAlert() {
  const { query, connect } = useConnectionWorkspace()
  const needsReconnect = query.data?.connections.some((connection) => connection.reconnectRequired) ?? false
  if (!needsReconnect) return null
  return (
    <Alert variant="warning">
      <AlertTitle>Reconnect Google to keep syncing</AlertTitle>
      <AlertDescription>
        Google access for one of your accounts has expired. Reconnect to resume reviews and publishing.
      </AlertDescription>
      <AlertAction>
        <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
          Reconnect
        </Button>
      </AlertAction>
    </Alert>
  )
}
