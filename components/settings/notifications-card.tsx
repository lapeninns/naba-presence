"use client"

import { ChevronRight, RefreshCw } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  // The operator's own choice of login and account. Auto-selection only
  // fills in when there is exactly one to choose; an agency login usually
  // reaches several Business Profile accounts, and without a picker the card
  // stayed on "Choose a Google account" with nothing to choose from.
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(null)
  const [selectedAccountName, setSelectedAccountName] = useState<
    string | null
  >(null)
  const connectionId = deriveAutoSelection({
    connections: connections.map((c) => ({ id: c.id, status: c.status })),
    accounts: [],
    selectedConnectionId,
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
    selectedAccountName,
  }).accountName
  const activeAccounts = accounts.filter((account) => account.isActive)
  const accountId =
    accounts.find((account) => account.googleAccountName === accountName)?.id ??
    null

  const setting = useNotificationSetting(accountId)
  const toast = useToastManager()
  const ids = useId()
  const [topic, setTopic] = useState<string | null>(null)
  const [types, setTypes] = useState<Set<string> | null>(null)
  const [topicError, setTopicError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState<boolean | null>(null)
  const topicRef = useRef<HTMLInputElement>(null)

  // Unsaved edits belong to the account they were made for.
  const resetEdits = () => {
    setTopic(null)
    setTypes(null)
    setTopicError(null)
  }

  const headingId = `${ids}-heading`
  const choosers =
    connections.length > 1 || activeAccounts.length > 1 ? (
      <div className="flex flex-wrap gap-3 border-b border-line px-(--np-card-pad) py-3">
        {connections.length > 1 ? (
          <Field className="min-w-[14rem] flex-1">
            <FieldLabel>Google login</FieldLabel>
            <Select
              value={connectionId ?? ""}
              onValueChange={(value: string | null) => {
                setSelectedConnectionId(value || null)
                setSelectedAccountName(null)
                resetEdits()
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) =>
                    connections.find((c) => c.id === value)?.googleEmail ??
                    "Google login"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {connection.googleEmail ?? "Google login"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {activeAccounts.length > 1 ? (
          <Field className="min-w-[14rem] flex-1">
            <FieldLabel>Business Profile account</FieldLabel>
            <Select
              value={accountName ?? ""}
              onValueChange={(value: string | null) => {
                setSelectedAccountName(value || null)
                resetEdits()
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) =>
                    activeAccounts.find(
                      (account) => account.googleAccountName === value
                    )?.accountName ?? "Choose an account"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((account) => (
                  <SelectItem
                    key={account.googleAccountName}
                    value={account.googleAccountName}
                  >
                    {account.accountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </div>
    ) : null
  const header = (
    <>
      <CardHeader divided>
        <CardTitle as="h2" id={headingId}>
          Real-time notifications
        </CardTitle>
        <CardDescription>
          Google can tell NabaPresence the moment a review arrives, instead of
          it waiting for the next scheduled check. Without this, reviews still
          arrive, just later.
        </CardDescription>
      </CardHeader>
      {choosers}
    </>
  )

  if (!accountId) {
    return (
      <Card flush aria-labelledby={headingId} role="region">
        {header}
        {activeAccounts.length > 1 ? (
          <Empty
            title="Choose a Business Profile account"
            description="Notifications are set per account. Pick one above to see and change what Google sends for it."
          />
        ) : (
          <Empty
            title="No active Google account"
            description="Activate one of this login’s Business Profile accounts while setting up a client, then manage its notifications here."
          />
        )}
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
  // Open by default only when a topic is already saved, and always when the
  // topic needs fixing; otherwise it follows the operator's own toggling
  // (never the field's contents, which would snap it shut mid-edit).
  const advancedShown =
    topicError !== null || (advancedOpen ?? Boolean(server.pubsubTopic))

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
        <p className="text-ui text-ink-secondary" role="status">
          {topicEmpty
            ? "Off. Reviews arrive on the scheduled check."
            : "On. Google sends new reviews as they happen."}
        </p>
        {/* The topic is Google Cloud plumbing, not something an agency
            chooses: it comes from whoever runs this NabaPresence install.
            Kept behind a disclosure so the card reads as on/off first. It
            opens by itself when a topic is set or needs fixing. */}
        <details
          className="group rounded-(--np-radius-control) border border-line"
          open={advancedShown}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 text-ui font-semibold text-ink focus-halo focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              strokeWidth={1.75}
              className="size-4 text-ink-muted transition-transform duration-(--np-duration-fast) group-open:rotate-90"
            />
            Advanced: Google Cloud Pub/Sub topic
          </summary>
          <div className="px-3 pb-3">
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
                The topic your NabaPresence administrator set up for Google to
                post to. If nobody has given you one, leave this empty. Clear it
                to turn notifications off.
              </FieldDescription>
              <FieldError>{topicError}</FieldError>
            </Field>
          </div>
        </details>
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
              Add a Pub/Sub topic under Advanced to choose what Google sends.
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
