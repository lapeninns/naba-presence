"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { TriangleAlert } from "lucide-react"
import { useId, useMemo, useState } from "react"

import { GateNote } from "@/components/locations/publish-gate"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
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
import { describeActionError } from "@/lib/errors/action-errors"
import { editSettingsDisabledReason } from "@/lib/settings/gating"
import {
  TIMEZONE_OPTIONS,
  settingsPolicyFormSchema,
} from "@/lib/settings/forms/settings-policy"
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

/** A field's validation message, in the row's description slot. */
function RowError({ children }: { children: string | undefined }) {
  if (!children) return null
  return (
    <span role="alert" className="text-danger-ink">
      {children}
    </span>
  )
}

/**
 * The reply policy, as grouped lists: a switch per on/off rule, a value on
 * the right for each figure, and one Save at the end. Nothing saves on
 * toggle — the server takes the whole policy at once, and the dirty guard
 * below keeps an unsaved change from being lost to a stray click.
 */
export function PolicyForm({ role }: { role: string | null }) {
  const query = useSettings()
  const caps = useSettingsCapabilities()
  const client = useQueryClient()
  const toast = useToastManager()
  const ids = useId()
  const isOwner = role === "owner"
  const canEdit = caps.data?.canEditSettings ?? false

  const initial = query.data ? toState(query.data) : null
  const [form, setForm] = useState<FormState | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({})
  const [formError, setFormError] = useState<string | null>(null)
  const current = form ?? initial

  const isDirty = useMemo(() => {
    if (!current || !initial) return false
    return JSON.stringify(current) !== JSON.stringify(initial)
  }, [current, initial])

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
      setFieldErrors({})
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
          if (typeof key === "string" && key in ({} as FormState)) {
            next[key as keyof FormState] = issue.message ?? "Invalid value."
          }
        }
        setFieldErrors(next)
      }
      setFormError(describeActionError(error))
    },
  })

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-(--np-gap-section)" aria-busy="true">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="ml-(--np-card-pad) h-3 w-20" />
          <Skeleton className="h-[calc(var(--np-row-h)*2)] w-full rounded-(--np-radius-card)" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="ml-(--np-card-pad) h-3 w-24" />
          <Skeleton className="h-(--np-row-h) w-full rounded-(--np-radius-card)" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="ml-(--np-card-pad) h-3 w-20" />
          <Skeleton className="h-[calc(var(--np-row-h)*2)] w-full rounded-(--np-radius-card)" />
        </div>
      </div>
    )
  }
  if (query.isError || !current) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn’t load your settings</AlertTitle>
        <AlertDescription>
          {describeActionError(query.error)}{" "}
          <Button variant="link" size="sm" onClick={() => query.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm({ ...current, [key]: value })
  }

  // Mirror the server rule: turning approval off needs an owner + explicit consent.
  const consentBlocked =
    !current.approvalRequired && (!isOwner || !current.directPublishConsent)
  const consentReason =
    !current.approvalRequired && !isOwner
      ? "Only an owner can turn off approval before replies publish."
      : null
  const editReason = editSettingsDisabledReason(caps.data)
  const parsed = settingsPolicyFormSchema.safeParse({
    approvalRequired: current.approvalRequired,
    requireTwoPersonApproval: current.requireTwoPersonApproval,
    rawContentRetentionDays: Number(current.rawContentRetentionDays),
    defaultLanguageCode: current.defaultLanguageCode,
    defaultTimezone: current.defaultTimezone,
    directPublishConsent: current.directPublishConsent,
  })
  const canSave =
    canEdit &&
    isDirty &&
    parsed.success &&
    !consentBlocked &&
    !mutation.isPending

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

  const approvalId = `${ids}-approval`
  const twoPersonId = `${ids}-two-person`
  const consentId = `${ids}-consent`
  const consentedOn = query.data?.directPublishConsentAt
    ? new Date(query.data.directPublishConsentAt).toLocaleDateString("en-GB")
    : null

  return (
    <form className="flex flex-col gap-(--np-gap-section)" onSubmit={onSubmit}>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <GroupedList header="Approval">
        <GroupedListItem
          label={
            <span id={approvalId}>Require approval before replies publish</span>
          }
          trailing={
            <Switch
              aria-labelledby={approvalId}
              checked={current.approvalRequired}
              disabled={!canEdit}
              onCheckedChange={(value) => set("approvalRequired", value)}
            />
          }
        />
        {current.approvalRequired ? (
          <GroupedListItem
            label={
              <span id={twoPersonId}>
                Require a second person to approve each reply
              </span>
            }
            trailing={
              <Switch
                aria-labelledby={twoPersonId}
                checked={current.requireTwoPersonApproval}
                disabled={!canEdit}
                onCheckedChange={(value) =>
                  set("requireTwoPersonApproval", value)
                }
              />
            }
          />
        ) : (
          <>
            <GroupedListItem
              icon={<TriangleAlert className="text-warning-ink" aria-hidden />}
              label="Replies will publish without approval"
              description={
                consentedOn
                  ? `Direct publishing was confirmed on ${consentedOn}.`
                  : undefined
              }
            />
            <GroupedListItem
              label={
                <span id={consentId}>
                  I confirm replies may publish to Google without approval
                </span>
              }
              description={consentReason ?? undefined}
              trailing={
                <Switch
                  aria-labelledby={consentId}
                  checked={current.directPublishConsent}
                  disabled={!isOwner || !canEdit}
                  onCheckedChange={(value) =>
                    set("directPublishConsent", value)
                  }
                />
              }
            />
          </>
        )}
      </GroupedList>

      <GroupedList header="Retention">
        <GroupedListItem
          label="Days to keep raw review content"
          description={
            <RowError>{fieldErrors.rawContentRetentionDays}</RowError>
          }
          trailing={
            <Input
              type="number"
              min={1}
              max={30}
              value={current.rawContentRetentionDays}
              disabled={!canEdit}
              aria-label="Days to keep raw review content"
              aria-invalid={
                fieldErrors.rawContentRetentionDays ? true : undefined
              }
              className="w-20 text-right"
              onChange={(event) =>
                set("rawContentRetentionDays", event.target.value)
              }
            />
          }
        />
      </GroupedList>

      <GroupedList header="Defaults">
        <GroupedListItem
          label="Default language"
          description={<RowError>{fieldErrors.defaultLanguageCode}</RowError>}
          trailing={
            <Input
              value={current.defaultLanguageCode}
              disabled={!canEdit}
              aria-label="Default language"
              aria-invalid={fieldErrors.defaultLanguageCode ? true : undefined}
              placeholder="en-GB"
              className="w-28"
              onChange={(event) =>
                set("defaultLanguageCode", event.target.value)
              }
            />
          }
        />
        <GroupedListItem
          label="Default timezone"
          description={<RowError>{fieldErrors.defaultTimezone}</RowError>}
          trailing={
            <Select
              value={current.defaultTimezone}
              disabled={!canEdit}
              onValueChange={(value: string | null) =>
                set("defaultTimezone", value ?? current.defaultTimezone)
              }
            >
              <SelectTrigger aria-label="Default timezone" className="max-w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </GroupedList>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <GateNote reason={editReason} />
        <Button type="submit" disabled={!canSave}>
          {mutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  )
}
