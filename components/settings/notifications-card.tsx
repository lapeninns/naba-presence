"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useToastManager } from "@/components/ui/toast"
import { GOOGLE_NOTIFICATION_TYPES } from "@/lib/domain/google-contract"
import { deriveAutoSelection } from "@/lib/connections/derive-auto-selection"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { useNotificationSetting } from "@/lib/queries/use-notification-setting"
import { describeActionError } from "@/lib/errors/action-errors"
import { describeNotificationType } from "@/lib/settings/gating"

const PUBSUB_TOPIC_RE = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][\w.-]{2,254}$/

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
    accounts: accounts.map((a) => ({ googleAccountName: a.googleAccountName, isActive: a.isActive })),
    selectedConnectionId: connectionId,
    selectedAccountName: null,
  }).accountName
  const accountId = accounts.find((account) => account.googleAccountName === accountName)?.id ?? null

  const setting = useNotificationSetting(accountId)
  const toast = useToastManager()
  const [topic, setTopic] = useState<string | null>(null)
  const [types, setTypes] = useState<Set<string> | null>(null)
  const [topicError, setTopicError] = useState<string | null>(null)

  if (!accountId) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-title">Google notifications</h2>
        <Empty title="Choose a Google account" description="Activate a Google account above to manage its notifications." />
      </section>
    )
  }
  if (setting.query.isPending) {
    return <Skeleton className="h-40 w-full" />
  }
  if (setting.query.isError) {
    return (
      <Empty
        title="We couldn’t load notifications"
        description={describeActionError(setting.query.error)}
        action={<Button variant="outline" onClick={() => setting.query.refetch()}>Try again</Button>}
      />
    )
  }

  const server = setting.query.data.setting
  const currentTopic = topic ?? server.pubsubTopic ?? ""
  const currentTypes = types ?? new Set(server.notificationTypes ?? [])

  const toggle = (type: string) => {
    const next = new Set(currentTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    setTypes(next)
  }

  const onSave = () => {
    const trimmed = currentTopic.trim()
    if (trimmed !== "" && !PUBSUB_TOPIC_RE.test(trimmed)) {
      setTopicError("Enter a topic like projects/my-project/topics/reviews, or clear it to turn notifications off.")
      return
    }
    setTopicError(null)
    setting.save.mutate(
      { accountId, pubsubTopic: trimmed, notificationTypes: [...currentTypes] },
      {
        onSuccess: () => {
          setTopic(null)
          setTypes(null)
          toast.add({ title: trimmed === "" ? "Notifications turned off" : "Notifications saved", type: "success" })
        },
        onError: (error) => toast.add({ title: describeActionError(error), type: "error" }),
      }
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Google notifications</h2>
      <Field error={topicError ?? undefined} className="max-w-xl">
        <FieldLabel>Pub/Sub topic</FieldLabel>
        <Input
          value={currentTopic}
          aria-label="Pub/Sub topic"
          placeholder="projects/my-project/topics/reviews"
          onChange={(event) => setTopic(event.target.value)}
        />
        <FieldError>{topicError}</FieldError>
        <p className="text-caption text-muted-foreground">Clear the topic to turn Google notifications off.</p>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-ui font-medium">Notify me about</legend>
        {GOOGLE_NOTIFICATION_TYPES.map((type) => (
          <label key={type} className="flex items-center gap-2 text-ui">
            <Checkbox
              checked={currentTypes.has(type)}
              disabled={currentTopic.trim() === ""}
              onCheckedChange={() => toggle(type)}
            />
            <span>{describeNotificationType(type)}</span>
          </label>
        ))}
      </fieldset>
      <div>
        <Button disabled={setting.save.isPending} onClick={onSave}>
          {setting.save.isPending ? "Saving…" : "Save notifications"}
        </Button>
      </div>
    </section>
  )
}
