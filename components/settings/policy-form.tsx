"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CircleCheck, Eye, Info, PenLine, RefreshCw } from "lucide-react"
import { useId, useMemo, useState } from "react"

import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  saveSettings,
  type OrgSettings,
  type SettingsPatchInput,
} from "@/lib/api/settings"
import { queryKeys } from "@/lib/queries/keys"
import { useSettings } from "@/lib/queries/use-settings"
import { useSettingsCapabilities } from "@/lib/queries/use-settings-capabilities"
import { ApiClientError } from "@/lib/api/client"
import { requiresDirectPublishConsent } from "@/lib/contracts/settings"
import { describeActionError } from "@/lib/errors/action-errors"
import { editSettingsDisabledReason } from "@/lib/settings/gating"
import { settingsPolicyFormSchema } from "@/lib/settings/forms/settings-policy"
import { languageLabel, languageOptionsFor } from "@/lib/settings/languages"
import { TimezonePicker } from "@/components/settings/timezone-picker"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"

type FormState = {
  approvalRequired: boolean
  requireTwoPersonApproval: boolean
  rawContentRetentionDays: string
  defaultLanguageCode: string
  defaultTimezone: string
  directPublishConsent: boolean
}

function toState(settings: OrgSettings): FormState {
  return {
    approvalRequired: settings.approvalRequired,
    requireTwoPersonApproval: settings.requireTwoPersonApproval,
    rawContentRetentionDays: String(settings.rawContentRetentionDays),
    defaultLanguageCode: settings.defaultLanguageCode,
    defaultTimezone: settings.defaultTimezone,
    directPublishConsent: false,
  }
}

/** The words the save bar uses to list what changed. */
const CHANGE_LABELS: Record<keyof FormState, string> = {
  approvalRequired: "Approval",
  directPublishConsent: "Approval",
  requireTwoPersonApproval: "Two-person rule",
  rawContentRetentionDays: "Retention",
  defaultLanguageCode: "Language",
  defaultTimezone: "Timezone",
}

const RETENTION_MESSAGE = "Enter a whole number of days from 1 to 30."

/** Client-side field problems, in the words the field shows. */
function localErrors(
  state: FormState
): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {}
  const days = state.rawContentRetentionDays.trim()
  if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 30) {
    errors.rawContentRetentionDays = RETENTION_MESSAGE
  }
  const language = settingsPolicyFormSchema.shape.defaultLanguageCode.safeParse(
    state.defaultLanguageCode
  )
  if (!language.success) {
    errors.defaultLanguageCode =
      language.error.issues[0]?.message ?? "Use a language code such as en-GB."
  }
  return errors
}

/** One labelled on/off rule: words on the left, the switch on the right. */
function SwitchRow({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={id} className="text-ui font-semibold text-ink">
          {label}
        </span>
        {hint ? (
          <span className="text-caption text-ink-muted">{hint}</span>
        ) : null}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}

/** A sunken note spelling out what the current choice means. */
function Consequence({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2.5 rounded-(--np-radius-control) bg-surface-alt px-3 py-2.5 text-ui text-ink-secondary"
    >
      <Info
        className="mt-0.5 size-4 shrink-0 text-ink-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <span>{children}</span>
    </p>
  )
}

function PolicySkeleton() {
  return (
    <div className="flex flex-col gap-(--np-gap-section)" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your policy
      </span>
      {[3, 1, 2].map((rows, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)"
        >
          <Skeleton className="h-4 w-1/3" />
          {Array.from({ length: rows }, (_, row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * The reply policy (reference `settings.html`): one card per concern —
 * approval, raw review content retention, defaults — and a save bar at the
 * foot that says what is unsaved. Nothing saves on toggle: the server takes
 * the whole policy at once, and the dirty guard keeps an unsaved change from
 * being lost to a stray reload. Values survive a refused save.
 *
 * Turning approval off needs an owner and an explicit confirmation, the
 * same rule the server enforces.
 */
export function PolicyForm({ role }: { role: string | null }) {
  const query = useSettings()
  const caps = useSettingsCapabilities()
  const client = useQueryClient()
  const toast = useToastManager()
  const ids = useId()
  const isOwner = role === "owner"
  const canEdit = caps.data?.canEditSettings ?? false
  const readOnly = caps.data !== undefined && !canEdit

  const initial = query.data ? toState(query.data) : null
  const [form, setForm] = useState<FormState | null>(null)
  const [serverErrors, setServerErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({})
  const [formError, setFormError] = useState<string | null>(null)
  const current = form ?? initial

  const changed = useMemo(() => {
    if (!current || !initial) return []
    const keys = (Object.keys(current) as (keyof FormState)[]).filter(
      (key) => current[key] !== initial[key]
    )
    return [...new Set(keys.map((key) => CHANGE_LABELS[key]))]
  }, [current, initial])
  const isDirty = changed.length > 0

  // Called for its effects only — arms beforeunload while dirty (spec §6). Do NOT
  // bind the return value; the repo lints unused vars as errors.
  useDirtyGuard({
    key: "settings-policy",
    isDirty,
    snapshot: () => JSON.stringify(current ?? {}),
  })

  const mutation = useMutation({
    mutationFn: (input: SettingsPatchInput) => saveSettings(input),
    onSuccess: async (settings) => {
      setForm(toState(settings))
      setServerErrors({})
      setFormError(null)
      await client.invalidateQueries({ queryKey: queryKeys.settings })
      toast.add({ title: "Settings saved", type: "success" })
    },
    onError: (error) => {
      if (error instanceof ApiClientError && Array.isArray(error.details)) {
        const next: Partial<Record<keyof FormState, string>> = {}
        for (const issue of error.details as Array<{
          path?: unknown[]
          message?: string
        }>) {
          const key = issue.path?.[0]
          if (typeof key === "string" && key in CHANGE_LABELS) {
            next[key as keyof FormState] = issue.message ?? "Invalid value."
          }
        }
        setServerErrors(next)
      }
      setFormError(describeActionError(error))
    },
  })

  if (query.isPending) return <PolicySkeleton />
  if (query.isError || !current) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn’t load your settings</AlertTitle>
        <AlertDescription>
          {describeActionError(query.error)} Your current policy is still in
          force; nothing was changed.
        </AlertDescription>
        <AlertActions>
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        </AlertActions>
      </Alert>
    )
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm({ ...current, [key]: value })
    if (serverErrors[key]) {
      setServerErrors((previous) => ({ ...previous, [key]: undefined }))
    }
  }

  // Mirror the server rule: TURNING approval off needs an owner + explicit
  // consent. Once it is off, saving another field needs neither.
  const turningApprovalOff = requiresDirectPublishConsent(
    initial?.approvalRequired ?? true,
    current
  )
  const consentBlocked =
    turningApprovalOff && (!isOwner || !current.directPublishConsent)
  const editReason = editSettingsDisabledReason(caps.data)
  const parsed = settingsPolicyFormSchema.safeParse({
    approvalRequired: current.approvalRequired,
    requireTwoPersonApproval: current.requireTwoPersonApproval,
    rawContentRetentionDays: Number(current.rawContentRetentionDays),
    defaultLanguageCode: current.defaultLanguageCode,
    defaultTimezone: current.defaultTimezone,
    directPublishConsent: current.directPublishConsent,
  })
  const local = localErrors(current)
  // A field's own problem shows once it has been changed; the server's
  // answer shows until the field is edited again.
  const fieldError = (key: keyof FormState) =>
    serverErrors[key] ??
    (initial && current[key] !== initial[key] ? local[key] : undefined)
  const canSave =
    canEdit &&
    isDirty &&
    parsed.success &&
    !consentBlocked &&
    !mutation.isPending

  const saveBlockedReason = !isDirty
    ? null
    : !parsed.success
      ? "Fix the marked fields to save."
      : consentBlocked
        ? isOwner
          ? "Tick the confirmation to publish without approval."
          : "Turning approval off needs an owner."
        : null

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!parsed.success || !canSave) return
    mutation.mutate({
      approvalRequired: parsed.data.approvalRequired,
      requireTwoPersonApproval: parsed.data.requireTwoPersonApproval,
      rawContentRetentionDays: parsed.data.rawContentRetentionDays,
      defaultLanguageCode: parsed.data.defaultLanguageCode,
      defaultTimezone: parsed.data.defaultTimezone,
      directPublishConsent: parsed.data.directPublishConsent,
    })
  }

  const discard = () => {
    setForm(null)
    setServerErrors({})
    setFormError(null)
  }

  const approvalId = `${ids}-approval`
  const twoPersonId = `${ids}-two-person`
  const consentedOn = query.data?.directPublishConsentAt
    ? new Date(query.data.directPublishConsentAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null

  // Mirrors lib/server/publishing/approval.ts `requiresApproval`: approval
  // parks replies from people who can't publish; the two-person rule parks
  // every reply, publisher or not, until someone else approves it.
  const consequence = current.requireTwoPersonApproval
    ? current.approvalRequired
      ? "Every reply, including one from someone who can publish, waits for a second person to approve it before it reaches Google. Nobody can approve their own reply."
      : "People who can’t publish can’t send replies. The two-person rule is still on, so every other reply waits for a second person to approve it."
    : current.approvalRequired
      ? "Replies from people who can’t publish wait in the Approval queue for someone who can. People who can publish send their replies straight to Google."
      : "People who can publish send their replies straight to Google, with no approval step. People who can’t publish can’t send replies."

  return (
    <form
      className="flex flex-col gap-(--np-gap-section)"
      onSubmit={onSubmit}
      noValidate
    >
      {readOnly ? (
        <Alert variant="info" icon={<Eye strokeWidth={1.75} aria-hidden />}>
          <AlertTitle>You can look, but not change this</AlertTitle>
          <AlertDescription>
            Only owners and admins can change the reply policy. Ask one of them
            if something here needs to change.
          </AlertDescription>
        </Alert>
      ) : null}

      {formError ? (
        <Alert variant="destructive">
          <AlertTitle>Your changes weren’t saved</AlertTitle>
          <AlertDescription>
            {formError} Your edits are still here, so you can fix them and save
            again.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card flush>
        <CardHeader divided>
          <CardTitle as="h2">Approval</CardTitle>
          <CardDescription>
            Who has to look at a reply before it goes to Google.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 py-(--np-card-pad)">
          <SwitchRow
            id={approvalId}
            label="Require approval before replies publish"
            hint="Replies from people who can’t publish wait in the Approval queue for someone who can."
          >
            <Switch
              aria-labelledby={approvalId}
              checked={current.approvalRequired}
              disabled={!canEdit}
              onCheckedChange={(value) =>
                setForm({
                  ...current,
                  approvalRequired: value,
                  directPublishConsent: value
                    ? false
                    : current.directPublishConsent,
                })
              }
            />
          </SwitchRow>

          <Consequence>{consequence}</Consequence>

          {current.approvalRequired ? (
            <SwitchRow
              id={twoPersonId}
              label="Require a second person to approve each reply"
              hint="The person who asked for approval can’t approve their own reply."
            >
              <Switch
                aria-labelledby={twoPersonId}
                checked={current.requireTwoPersonApproval}
                disabled={!canEdit}
                onCheckedChange={(value) =>
                  set("requireTwoPersonApproval", value)
                }
              />
            </SwitchRow>
          ) : (
            <Alert variant="warning">
              <AlertTitle>Replies will publish without approval</AlertTitle>
              <AlertDescription className="flex flex-col gap-2.5">
                <span>
                  {turningApprovalOff
                    ? isOwner
                      ? "Only an owner can confirm this."
                      : "Only an owner can turn off approval before replies publish."
                    : "Direct publishing is on."}
                  {consentedOn
                    ? ` Direct publishing was confirmed on ${consentedOn}.`
                    : ""}
                </span>
                {turningApprovalOff ? (
                  <Checkbox
                    checked={current.directPublishConsent}
                    disabled={!isOwner || !canEdit}
                    onCheckedChange={(value) =>
                      set("directPublishConsent", value === true)
                    }
                    label="I confirm replies may publish to Google without approval"
                  />
                ) : null}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card flush>
        <CardHeader divided>
          <CardTitle as="h2">Raw review content retention</CardTitle>
          <CardDescription>
            How long we keep the customer’s review text after it arrives.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-(--np-card-pad)">
          <Field
            error={fieldError("rawContentRetentionDays")}
            className="grid grid-cols-1 gap-x-4 gap-y-1.5 @[32rem]:grid-cols-[minmax(0,1fr)_auto] @[32rem]:items-center"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <FieldLabel>Days to keep raw review content</FieldLabel>
              <FieldDescription>
                1 to 30 days. After this, the text is deleted here; it stays on
                Google.
              </FieldDescription>
            </div>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              value={current.rawContentRetentionDays}
              disabled={!canEdit}
              className="w-24 text-right font-mono tabular-nums"
              onChange={(event) =>
                set("rawContentRetentionDays", event.target.value)
              }
            />
            <FieldError className="@[32rem]:col-span-2">
              {fieldError("rawContentRetentionDays")}
            </FieldError>
          </Field>
        </CardContent>
      </Card>

      <Card flush>
        <CardHeader divided>
          <CardTitle as="h2">Defaults</CardTitle>
          <CardDescription>
            What new replies and schedules start from.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 py-(--np-card-pad) @[36rem]:grid-cols-2">
          <Field error={fieldError("defaultLanguageCode")}>
            <FieldLabel>Default language</FieldLabel>
            <Select
              value={current.defaultLanguageCode}
              disabled={!canEdit}
              onValueChange={(value: string | null) =>
                set("defaultLanguageCode", value ?? current.defaultLanguageCode)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) => languageLabel(value)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {languageOptionsFor(current.defaultLanguageCode).map(
                  (option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            <FieldDescription>
              The language new reply drafts are written in when a review’s own
              language can’t be told.
            </FieldDescription>
            <FieldError>{fieldError("defaultLanguageCode")}</FieldError>
          </Field>
          <Field error={fieldError("defaultTimezone")}>
            <FieldLabel>Default timezone</FieldLabel>
            <TimezonePicker
              value={current.defaultTimezone}
              disabled={!canEdit}
              onChange={(zone) => set("defaultTimezone", zone)}
            />
            <FieldDescription>
              Opening hours and report windows are read in this timezone unless
              a listing sets its own.
            </FieldDescription>
            <FieldError>{fieldError("defaultTimezone")}</FieldError>
          </Field>
        </CardContent>
      </Card>

      <ActionBar
        label="Save reply policy"
        offset="bottom-3"
        status={
          readOnly ? (
            <>
              <Eye aria-hidden />
              <span>
                View only · <ActionBarMuted>{editReason}</ActionBarMuted>
              </span>
            </>
          ) : isDirty ? (
            <>
              <PenLine aria-hidden />
              <span>
                <strong className="font-semibold">
                  {changed.length} unsaved{" "}
                  {changed.length === 1 ? "change" : "changes"}
                </strong>{" "}
                ·{" "}
                <ActionBarMuted>
                  {saveBlockedReason ?? changed.join(", ")}
                </ActionBarMuted>
              </span>
            </>
          ) : (
            <>
              <CircleCheck aria-hidden />
              <span>All changes saved</span>
            </>
          )
        }
        actions={
          readOnly ? (
            <Button type="submit" disabled>
              Save changes
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost-dark"
                disabled={!isDirty || mutation.isPending}
                onClick={discard}
              >
                Discard
              </Button>
              <Button
                type="submit"
                disabled={!canSave && !mutation.isPending}
                pending={mutation.isPending}
                pendingLabel="Saving…"
              >
                Save changes
              </Button>
            </>
          )
        }
      />
    </form>
  )
}
