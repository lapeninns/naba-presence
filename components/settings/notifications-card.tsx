"use client"

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useToastManager } from "@/components/ui/toast"
import { GOOGLE_NOTIFICATION_TYPES } from "@/lib/domain/google-contract"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { useNotificationSetting } from "@/lib/queries/use-notification-setting"
import { describeActionError } from "@/lib/errors/action-errors"
import { describeNotificationType } from "@/lib/settings/gating"

const PUBSUB_TOPIC_RE =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][\w.-]{2,254}$/

/**
 * Google's real-time notifications for the working account: the Pub/Sub
 * topic Google should post to, and a switch per event kind. Nothing saves on
 * toggle — the setting is one object on Google's side, written once.
 */
export function NotificationsCard() {
  const workspace = useConnectionWorkspace()
  const connections = workspace.query.data?.connections ?? []
  const connectionId = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: [],
    selectedConnectionId: null,
    selectedAccountName: null,
  }).connectionId
  const accountsQuery = useGoogleAccounts(connectionId)
  const accounts = accountsQuery.query.data?.accounts ?? []
  const accountName = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: accounts.map((a) => ({
      googleAccountName: a.googleAccountName,
      isActive: a.isActive,
    })),
    selectedConnectionId: connectionId,
    selectedAccountName: null,
  }).accountName
  const accountId =
    accounts.find((account) => account.googleAccountName === accountName)?.id ??
    null

  const setting = useNotificationSetting(accountId)
  const toast = useToastManager()
  const ids = useId()
  const [topic, setTopic] = useState<string | null>(null)
  const [types, setTypes] = useState<Set<string> | null>(null)
  const [topicError, setTopicError] = useState<string | null>(null)

  const heading = (
    <h2 id={`${ids}-heading`} className="text-title font-semibold text-ink">
      Google notifications
    </h2>
  )

  if (!accountId) {
    return (
      <section
        aria-labelledby={`${ids}-heading`}
        className="flex flex-col gap-3"
      >
        {heading}
        <Empty
          title="Choose a Google account"
          description="Activate a Google account above to manage its notifications."
        />
      </section>
    )
  }
  if (setting.query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-[calc(var(--np-row-h)*3)] w-full rounded-(--np-radius-card)" />
      </div>
    )
  }
  if (setting.query.isError) {
    return (
      <Empty
        title="We couldn’t load notifications"
        description={describeActionError(setting.query.error)}
        action={
          <Button variant="outline" onClick={() => setting.query.refetch()}>
            Try again
          </Button>
        }
      />
    )
  }

  const server = setting.query.data.setting
  const currentTopic = topic ?? server.pubsubTopic ?? ""
  const currentTypes = types ?? new Set(server.notificationTypes ?? [])
  const topicEmpty = currentTopic.trim() === ""

  const toggle = (type: string) => {
    const next = new Set(currentTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    setTypes(next)
  }

  const onSave = () => {
    const trimmed = currentTopic.trim()
    if (trimmed !== "" && !PUBSUB_TOPIC_RE.test(trimmed)) {
      setTopicError(
        "Enter a topic like projects/my-project/topics/reviews, or clear it to turn notifications off."
      )
      return
    }
    setTopicError(null)
    setting.save.mutate(
      { accountId, pubsubTopic: trimmed, notificationTypes: [...currentTypes] },
      {
        onSuccess: () => {
          setTopic(null)
          setTypes(null)
          toast.add({
            title:
              trimmed === ""
                ? "Notifications turned off"
                : "Notifications saved",
            type: "success",
          })
        },
        onError: (error) =>
          toast.add({ title: describeActionError(error), type: "error" }),
      }
    )
  }

  const topicErrorId = `${ids}-topic-error`

  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3">
      {heading}
      <GroupedList
        aria-label="Google notification settings"
        footer="Clear the topic to turn Google notifications off."
      >
        <GroupedListItem
          label={<span id={`${ids}-topic`}>Pub/Sub topic</span>}
          className="flex-col items-stretch gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-3"
          trailing={
            <span className="flex w-full flex-col gap-1 sm:w-80">
              <Input
                value={currentTopic}
                aria-label="Pub/Sub topic"
                aria-invalid={topicError ? true : undefined}
                aria-describedby={topicError ? topicErrorId : undefined}
                placeholder="projects/my-project/topics/reviews"
                onChange={(event) => setTopic(event.target.value)}
              />
              {topicError ? (
                <span
                  id={topicErrorId}
                  role="alert"
                  className="text-caption text-danger-ink"
                >
                  {topicError}
                </span>
              ) : null}
            </span>
          }
        />
        {GOOGLE_NOTIFICATION_TYPES.map((type) => {
          const labelId = `${ids}-${type}`
          return (
            <GroupedListItem
              key={type}
              label={<span id={labelId}>{describeNotificationType(type)}</span>}
              trailing={
                <Switch
                  aria-labelledby={labelId}
                  checked={currentTypes.has(type)}
                  disabled={topicEmpty}
                  onCheckedChange={() => toggle(type)}
                />
              }
            />
          )
        })}
      </GroupedList>
      <div className="flex justify-end">
        <Button disabled={setting.save.isPending} onClick={onSave}>
          {setting.save.isPending ? "Saving…" : "Save notifications"}
        </Button>
      </div>
    </section>
  )
}
