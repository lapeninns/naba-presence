"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ApiClientError } from "@/lib/api/client"
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/api/operational-notifications"
import {
  NOTIFICATION_EVENT_LABELS,
  type NotificationEventKind,
  type NotificationMode,
} from "@/lib/domain/notification-preferences"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"

const EMAIL_LABEL: Record<NotificationMode, string> = {
  immediate: "Immediately",
  digest: "Daily summary",
  off: "Off",
}

/**
 * The signed-in person's own choices, saved one change at a time. Separate
 * from Google's notification settings, which configure the review feed.
 */
export function NotificationPreferences() {
  const client = useQueryClient()
  const [failure, setFailure] = useState<string | null>(null)
  const query = useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: (context) => fetchNotificationPreferences(requestOptions(context)),
  })
  const save = useMutation({
    mutationFn: (change: {
      kind: NotificationEventKind
      channel: "in_app" | "email"
      mode: NotificationMode
    }) => updateNotificationPreferences([change]),
    onSuccess: (data) => {
      setFailure(null)
      client.setQueryData(queryKeys.notificationPreferences, data)
    },
    onError: (error) =>
      setFailure(
        error instanceof ApiClientError
          ? error.message
          : "The choice could not be saved. Try again."
      ),
  })
  const rows = query.data
    ? [...new Set(query.data.preferences.map((preference) => preference.kind))]
    : []
  const mode = (kind: NotificationEventKind, channel: "in_app" | "email") =>
    query.data?.preferences.find(
      (preference) => preference.kind === kind && preference.channel === channel
    )?.mode ?? "off"

  return (
    <div className="flex flex-col gap-4">
      {query.data && !query.data.emailConfigured ? (
        <Alert variant="info">
          <AlertTitle>Email is not set up</AlertTitle>
          <AlertDescription>
            No notification email is sent until an email provider is configured.
            Notifications still appear in the app.
          </AlertDescription>
        </Alert>
      ) : null}
      {failure ? (
        <p role="alert" className="text-ui text-danger-ink">
          {failure}
        </p>
      ) : null}
      <QueryStates
        status={queryStatus(query)}
        pendingLabel="notification settings"
        error="Notification settings could not be loaded"
        onRetry={() => void query.refetch()}
      >
        <ul
          className="flex flex-col divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface"
          aria-label="Notification choices"
        >
          {rows.map((kind) => {
            const copy = NOTIFICATION_EVENT_LABELS[kind],
              id = `notification-${kind}`
            return (
              <li
                key={kind}
                className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_11rem] sm:items-center"
              >
                <div className="min-w-0">
                  <p id={id} className="text-ui font-semibold text-ink">
                    {copy.label}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {copy.description}
                  </p>
                </div>
                <span className="flex items-center gap-2 text-ui text-ink-secondary">
                  <Switch
                    checked={mode(kind, "in_app") === "immediate"}
                    disabled={save.isPending}
                    onCheckedChange={(checked) =>
                      save.mutate({
                        kind,
                        channel: "in_app",
                        mode: checked ? "immediate" : "off",
                      })
                    }
                   aria-label={`In app: ${copy.label}`}
                  />
                  <span aria-hidden>In app</span>
                </span>
                <Select
                  value={mode(kind, "email")}
                  disabled={save.isPending}
                  onValueChange={(value) =>
                    save.mutate({
                      kind,
                      channel: "email",
                      mode: value as NotificationMode,
                    })
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={`Email: ${copy.label}`}
                  >
                    <SelectValue>
                      {(value: string | null) =>
                        `Email: ${EMAIL_LABEL[(value ?? "off") as NotificationMode]}`
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(["immediate", "digest", "off"] as const).map((option) => (
                      <SelectItem key={option} value={option}>
                        {EMAIL_LABEL[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            )
          })}
        </ul>
      </QueryStates>
    </div>
  )
}
