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
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const EMAIL_LABEL: Record<NotificationMode, string> = {
  immediate: "Immediately",
  digest: "Daily summary",
  off: "Off",
}

type Channel = "in_app" | "email"
type Change = {
  kind: NotificationEventKind
  channel: Channel
  mode: NotificationMode
}

/**
 * The signed-in person's own choices, saved one change at a time (the
 * autosave model of the settings save contract, policy-form.tsx). Each
 * change's outcome — "Saving…", "Saved", or why it failed — is said in the
 * row that changed, beside its controls, not at the top of a long list.
 * Separate from Google's notification settings, which configure the review
 * feed.
 */
export function NotificationPreferences() {
  const client = useQueryClient()
  // The row the latest change was made in ("all" for the group action),
  // and how it went.
  const [last, setLast] = useState<{
    kind: NotificationEventKind | "all"
    state: "saving" | "saved" | "failed"
    message?: string
  } | null>(null)
  const query = useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: (context) => fetchNotificationPreferences(requestOptions(context)),
  })
  // One change from a row, or every in-app change from "Turn all on/off" in
  // a single request (the endpoint takes 1–40 changes at once).
  const save = useMutation({
    mutationFn: (changes: Change | Change[]) =>
      updateNotificationPreferences(
        Array.isArray(changes) ? changes : [changes]
      ),
    onMutate: (changes) =>
      setLast({ kind: subjectOf(changes), state: "saving" }),
    onSuccess: (data, changes) => {
      setLast({ kind: subjectOf(changes), state: "saved" })
      client.setQueryData(queryKeys.notificationPreferences, data)
    },
    onError: (error, changes) =>
      setLast({
        kind: subjectOf(changes),
        state: "failed",
        message:
          error instanceof ApiClientError
            ? error.message
            : "The choice could not be saved. Try again.",
      }),
  })
  const rows = query.data
    ? [...new Set(query.data.preferences.map((preference) => preference.kind))]
    : []
  const mode = (kind: NotificationEventKind, channel: Channel) =>
    query.data?.preferences.find(
      (preference) => preference.kind === kind && preference.channel === channel
    )?.mode ?? "off"
  // "Turn all on" while any in-app choice is off; "Turn all off" once all are on.
  const allInAppOn =
    rows.length > 0 &&
    rows.every((kind) => mode(kind, "in_app") === "immediate")
  const groupOutcome = last?.kind === "all" ? last : null

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
      <QueryStates
        status={queryStatus(query)}
        pendingLabel="Loading your notification settings"
        error="Notification settings could not be loaded"
        onRetry={() => void query.refetch()}
      >
        <section
          aria-labelledby="notification-events-label"
          className="flex flex-col gap-1.5"
        >
          <div className="flex min-h-(--np-touch) flex-wrap items-center justify-between gap-x-3 px-1 desk:min-h-0">
            <h2
              id="notification-events-label"
              className="text-ui font-medium text-ink-muted"
            >
              Notify me about
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-accent-ink"
              disabled={save.isPending || rows.length === 0}
              onClick={() =>
                save.mutate(
                  rows.map((kind) => ({
                    kind,
                    channel: "in_app" as const,
                    mode: allInAppOn
                      ? ("off" as const)
                      : ("immediate" as const),
                  }))
                )
              }
            >
              {allInAppOn ? "Turn all off in app" : "Turn all on in app"}
            </Button>
          </div>
          <p
            aria-live="polite"
            data-slot="preference-status"
            className={cn(
              "px-1 text-ui empty:sr-only",
              groupOutcome?.state === "failed"
                ? "text-danger-ink"
                : "text-ink-muted"
            )}
          >
            {groupOutcome?.state === "saving"
              ? "Saving…"
              : groupOutcome?.state === "saved"
                ? "Saved"
                : groupOutcome?.state === "failed"
                  ? `Not saved. ${groupOutcome.message}`
                  : null}
          </p>
          <ul
            className="flex flex-col md:divide-y md:divide-line md:overflow-hidden md:rounded-(--np-radius-card) md:border md:border-line md:bg-surface"
            aria-label="Notification choices"
          >
            {rows.map((kind) => {
              const copy = NOTIFICATION_EVENT_LABELS[kind]
              const outcome = last?.kind === kind ? last : null
              return (
                <li
                  key={kind}
                  className="grid grid-cols-1 gap-x-4 gap-y-2 px-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center md:px-(--np-card-pad)"
                >
                  <div className="min-w-0">
                    <p className="text-body font-medium text-ink">
                      {copy.label}
                    </p>
                    <p className="text-caption text-ink-muted">
                      {copy.description}
                    </p>
                  </div>
                  <Switch
                    // The words are the tap target; the name keeps the row's
                    // subject ("In app: New reviews") for a screen reader. The
                    // name is one text run: an sr-only sibling is block-level
                    // and would put a space before the colon.
                    label={
                      <>
                        <span aria-hidden="true">In app</span>
                        <span className="sr-only">In app: {copy.label}</span>
                      </>
                    }
                    labelClassName="justify-start gap-3 text-ui text-ink-secondary"
                    checked={mode(kind, "in_app") === "immediate"}
                    disabled={save.isPending}
                    onCheckedChange={(checked) =>
                      save.mutate({
                        kind,
                        channel: "in_app",
                        mode: checked ? "immediate" : "off",
                      })
                    }
                  />
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
                      className="w-full sm:w-44"
                      aria-label={`Email: ${copy.label}`}
                    >
                      <SelectValue>
                        {(value: string | null) =>
                          `Email: ${EMAIL_LABEL[(value ?? "off") as NotificationMode]}`
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(["immediate", "digest", "off"] as const).map(
                        (option) => (
                          <SelectItem key={option} value={option}>
                            {EMAIL_LABEL[option]}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <p
                    aria-live="polite"
                    data-slot="preference-status"
                    className={cn(
                      "text-ui empty:sr-only sm:col-span-3 sm:text-right",
                      outcome?.state === "failed"
                        ? "text-danger-ink"
                        : "text-ink-muted"
                    )}
                  >
                    {outcome?.state === "saving"
                      ? "Saving…"
                      : outcome?.state === "saved"
                        ? "Saved"
                        : outcome?.state === "failed"
                          ? `Not saved. ${outcome.message}`
                          : null}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>
      </QueryStates>
    </div>
  )
}

function subjectOf(changes: Change | Change[]): NotificationEventKind | "all" {
  return Array.isArray(changes) ? "all" : changes.kind
}
