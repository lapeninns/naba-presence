"use client"

import { RefreshCw } from "lucide-react"
import { useId, useRef, useState } from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty } from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
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
 * Google's real-time notifications for the working account (reference
 * `notifications-section`): the Pub/Sub topic Google should post to, and a
 * switch per event kind. Nothing saves on toggle — the setting is one object
 * on Google's side, written once from the card's footer.
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
  const topicRef = useRef<HTMLInputElement>(null)

  const headingId = `${ids}-heading`
  const header = (
    <CardHeader divided>
      <CardTitle as="h2" id={headingId}>
        Real-time notifications
      </CardTitle>
      <CardDescription>
        Google posts new reviews to a Pub/Sub topic, so they arrive within
        minutes instead of waiting for the next sync.
      </CardDescription>
    </CardHeader>
  )

  if (!accountId) {
    return (
      <Card flush aria-labelledby={headingId} role="region">
        {header}
        <Empty
          title="Choose a Google account"
          description="Activate one of this login’s Business Profile accounts while setting up a client, then manage its notifications here."
        />
      </Card>
    )
  }
  if (setting.query.isPending) {
    return (
      <Card flush aria-busy="true" aria-labelledby={headingId} role="region">
        {header}
        <div className="flex flex-col gap-3 p-(--np-card-pad)">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-[calc(var(--np-row-h)*3)] w-full" />
        </div>
      </Card>
    )
  }
  if (setting.query.isError) {
    return (
      <Card flush aria-labelledby={headingId} role="region">
        {header}
        <div className="p-(--np-card-pad)">
          <Alert variant="destructive">
            <AlertTitle>We couldn’t load notifications</AlertTitle>
            <AlertDescription>
              {describeActionError(setting.query.error)} Nothing was changed on
              Google.
            </AlertDescription>
            <AlertActions>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setting.query.refetch()}
              >
                <RefreshCw aria-hidden />
                Try again
              </Button>
            </AlertActions>
          </Alert>
        </div>
      </Card>
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
      topicRef.current?.focus()
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

  const typesLabelId = `${ids}-types`

  return (
    <Card flush aria-labelledby={headingId} role="region">
      {header}
      <div className="flex flex-col gap-5 p-(--np-card-pad)">
        <Field error={topicError ?? undefined}>
          <FieldLabel>Pub/Sub topic</FieldLabel>
          <Input
            ref={topicRef}
            value={currentTopic}
            autoComplete="off"
            spellCheck={false}
            placeholder="projects/my-project/topics/reviews"
            className="font-mono"
            onChange={(event) => {
              setTopic(event.target.value)
              if (topicError) setTopicError(null)
            }}
          />
          <FieldDescription>
            Clear the topic to turn Google notifications off.
          </FieldDescription>
          <FieldError>{topicError}</FieldError>
        </Field>
        <div
          role="group"
          aria-labelledby={typesLabelId}
          className="flex flex-col gap-1.5"
        >
          <span id={typesLabelId} className="text-ui font-semibold text-ink">
            What Google should tell us about
          </span>
          <ul className="flex flex-col divide-y divide-line rounded-(--np-radius-control) border border-line">
            {GOOGLE_NOTIFICATION_TYPES.map((type) => {
              const labelId = `${ids}-${type}`
              return (
                <li
                  key={type}
                  className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5"
                >
                  <span id={labelId} className="text-ui text-ink">
                    {describeNotificationType(type)}
                  </span>
                  <Switch
                    aria-labelledby={labelId}
                    checked={currentTypes.has(type)}
                    disabled={topicEmpty}
                    onCheckedChange={() => toggle(type)}
                  />
                </li>
              )
            })}
          </ul>
          {topicEmpty ? (
            <p className="text-caption text-ink-muted">
              Add a topic to choose what Google sends.
            </p>
          ) : null}
        </div>
      </div>
      <CardFooter bar className="justify-end">
        <Button
          pending={setting.save.isPending}
          pendingLabel="Saving…"
          onClick={onSave}
        >
          Save notifications
        </Button>
      </CardFooter>
    </Card>
  )
}
