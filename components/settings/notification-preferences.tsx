"use client"

import {
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ChevronRightIcon } from "lucide-react"
import Link from "next/link"

import { QueryStates, queryStatus } from "@/components/ui/query-states"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SettingsGroup,
  SettingsGroupAction,
  SettingsRow,
} from "@/components/ui/settings-row"
import { showToast } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/api/operational-notifications"
import type { NotificationPreferencesResponse } from "@/lib/contracts/operational-notifications"
import {
  NOTIFICATION_EVENT_LABELS,
  type NotificationEventKind,
  type NotificationMode,
} from "@/lib/domain/notification-preferences"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useOptimisticMutation } from "@/lib/queries/use-optimistic-mutation"

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

const SAVE_KEY = ["notification-preferences", "save"] as const
const rowKey = (kind: NotificationEventKind, channel: Channel) =>
  `${kind}:${channel}`

/**
 * The signed-in person's own choices, saved one change at a time (the
 * autosave model of the settings save contract, policy-form.tsx). A change
 * shows at once and puts itself back, with an error toast, if the server
 * refuses it; only the row being saved is disabled, never the list.
 * "Turn all on/off" offers Undo. Email cadence is a chevron row opening a
 * titled select sheet, offered only once an email provider exists.
 * Separate from Google's notification settings, which configure the review
 * feed.
 *
 * `role` is the signed-in role: only an owner or admin can set up email, so
 * only they are pointed to Operations when it is missing.
 */
export function NotificationPreferences({ role }: { role: string | null }) {
  const query = useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: (context) => fetchNotificationPreferences(requestOptions(context)),
  })
  // One change from a row, or every in-app change from "Turn all on/off" in
  // a single request (the endpoint takes 1–40 changes at once).
  const save = useOptimisticMutation<
    NotificationPreferencesResponse,
    Change[],
    NotificationPreferencesResponse
  >({
    mutationKey: SAVE_KEY,
    // One write at a time, in the order they were made: each change still
    // shows at once (onMutate runs immediately), but a row save, the bulk
    // change and its Undo can never reach the server out of order and
    // overwrite one another.
    scope: { id: "notification-preferences-save" },
    mutationFn: (changes) => updateNotificationPreferences(changes),
    queryKey: queryKeys.notificationPreferences,
    update: (current, changes) => current && applyChanges(current, changes),
    errorTitle: "Your notification choice wasn’t saved",
    errorDescription: (error) =>
      error instanceof ApiClientError ? error.message : "Try again.",
  })
  // The rows with a save in flight, and whether the group action is mid-save.
  const pending = useMutationState({
    filters: { mutationKey: SAVE_KEY, status: "pending" },
    select: (mutation) => mutation.state.variables as Change[],
  })
  const saving = new Set(
    pending.flat().map((change) => rowKey(change.kind, change.channel))
  )
  // The group action waits for every save in flight, a single row's too.
  const anySaving = pending.length > 0
  const queryClient = useQueryClient()

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

  const turnAll = () => {
    const target: NotificationMode = allInAppOn ? "off" : "immediate"
    const changes = rows.map((kind) => ({
      kind,
      channel: "in_app" as const,
      mode: target,
    }))
    // Undo puts back what each row held before, in the same single request.
    const previous = rows
      .filter((kind) => mode(kind, "in_app") !== target)
      .map((kind) => ({
        kind,
        channel: "in_app" as const,
        mode: mode(kind, "in_app"),
      }))
    // `mutateAsync`, not per-call `mutate` callbacks: those only fire for the
    // latest call, and this one must report its own outcome even when another
    // save starts before it returns. The hook has already toasted a failure.
    void save.mutateAsync(changes).then(() => {
      if (previous.length === 0) return
      showToast({
        id: "notification-preferences-bulk",
        title: allInAppOn
          ? "Turned off in-app notifications"
          : "Turned on in-app notifications",
        undo: {
          // Only the rows still as the bulk change left them: a row changed
          // since keeps its newer choice.
          onUndo: () => {
            const now =
              queryClient.getQueryData<NotificationPreferencesResponse>(
                queryKeys.notificationPreferences
              )
            const restore = previous.filter(
              (change) =>
                now?.preferences.find(
                  (preference) =>
                    preference.kind === change.kind &&
                    preference.channel === "in_app"
                )?.mode === target
            )
            if (restore.length > 0) save.mutate(restore)
          },
        },
      })
    }, noop)
  }

  const emailConfigured = query.data?.emailConfigured ?? true
  const canSetUpEmail = role === "owner" || role === "admin"

  return (
    <QueryStates
      status={queryStatus(query)}
      pendingLabel="Loading your notification settings"
      error={{
        title: "Notification settings could not be loaded",
        description: "We couldn't load your notification settings. Try again.",
      }}
      onRetry={() => void query.refetch()}
    >
      <SettingsGroup
        card
        label="In the app"
        id="notification-in-app"
        action={
          <SettingsGroupAction
            disabled={anySaving || rows.length === 0}
            onClick={turnAll}
          >
            {allInAppOn ? "Turn all off in app" : "Turn all on in app"}
          </SettingsGroupAction>
        }
        listProps={{ "aria-label": "In-app notification choices" }}
      >
        {rows.map((kind) => {
          const copy = NOTIFICATION_EVENT_LABELS[kind]
          return (
            <SettingsRow
              key={kind}
              label={copy.label}
              description={copy.description}
              checked={mode(kind, "in_app") === "immediate"}
              disabled={saving.has(rowKey(kind, "in_app"))}
              onCheckedChange={(checked) =>
                save.mutate([
                  {
                    kind,
                    channel: "in_app",
                    mode: checked ? "immediate" : "off",
                  },
                ])
              }
            />
          )
        })}
      </SettingsGroup>
      <SettingsGroup
        // No rows without a provider: a card would draw an empty box.
        card={emailConfigured}
        label="By email"
        id="notification-email"
        bodyAs={emailConfigured ? "ul" : "div"}
        listProps={{ "aria-label": "Email notification choices" }}
        caption={
          emailConfigured ? undefined : (
            <>
              Email notifications aren’t available for this workspace yet.
              You’ll still see them in the app.
              {canSetUpEmail ? (
                <>
                  {" "}
                  Set up email in{" "}
                  <Link
                    href="/settings/operations"
                    className="text-accent-ink underline underline-offset-2"
                  >
                    Operations
                  </Link>
                  .
                </>
              ) : null}
            </>
          )
        }
      >
        {emailConfigured
          ? rows.map((kind) => {
              const copy = NOTIFICATION_EVENT_LABELS[kind]
              return (
                <SettingsRow
                  key={kind}
                  label={copy.label}
                  className="relative"
                  action={
                    <Select
                      value={mode(kind, "email")}
                      disabled={saving.has(rowKey(kind, "email"))}
                      onValueChange={(value) =>
                        save.mutate([
                          {
                            kind,
                            channel: "email",
                            mode: value as NotificationMode,
                          },
                        ])
                      }
                    >
                      {/* The trigger covers the whole row, so the words and
                          the value are one tap target, like a chevron row. */}
                      <SelectTrigger
                        aria-label={`Email: ${copy.label}`}
                        className="absolute inset-0 h-auto w-full justify-end gap-1 border-0 bg-transparent px-2 text-ui text-ink-muted focus-visible:shadow-none focus-visible:ring-2 focus-visible:ring-(--np-focus-ring) focus-visible:ring-inset disabled:bg-transparent data-popup-open:shadow-none forced-colors:focus-visible:outline-2 forced-colors:focus-visible:-outline-offset-2 forced-colors:focus-visible:outline-solid data-disabled:bg-transparent [&_[data-slot=select-icon]]:hidden"
                      >
                        <SelectValue>
                          {(value: string | null) =>
                            EMAIL_LABEL[(value ?? "off") as NotificationMode]
                          }
                        </SelectValue>
                        <ChevronRightIcon
                          aria-hidden="true"
                          className="size-5 shrink-0 text-ink-muted"
                        />
                      </SelectTrigger>
                      <SelectContent title={`Email: ${copy.label}`}>
                        {(["immediate", "digest", "off"] as const).map(
                          (option) => (
                            <SelectItem key={option} value={option}>
                              {EMAIL_LABEL[option]}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  }
                />
              )
            })
          : null}
      </SettingsGroup>
    </QueryStates>
  )
}

function noop() {}

/** The cache as it will read once `changes` are saved. */
function applyChanges(
  current: NotificationPreferencesResponse,
  changes: Change[]
): NotificationPreferencesResponse {
  const preferences = current.preferences.map((preference) => {
    const change = changes.find(
      (candidate) =>
        candidate.kind === preference.kind &&
        candidate.channel === preference.channel
    )
    return change
      ? { ...preference, mode: change.mode, explicit: true }
      : preference
  })
  return { ...current, preferences }
}
