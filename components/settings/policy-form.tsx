"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { GateNote } from "@/components/locations/publish-gate"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToastManager } from "@/components/ui/toast"
import { saveSettings, type OrgSettings, type SettingsPatchInput } from "@/lib/api/settings"
import { queryKeys } from "@/lib/queries/keys"
import { useSettings } from "@/lib/queries/use-settings"
import { useSettingsCapabilities } from "@/lib/queries/use-settings-capabilities"
import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/settings/action-errors"
import { editSettingsDisabledReason } from "@/lib/settings/gating"
import { TIMEZONE_OPTIONS, settingsPolicyFormSchema } from "@/lib/settings/forms/settings-policy"
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

export function PolicyForm({ role }: { role: string | null }) {
  const query = useSettings()
  const caps = useSettingsCapabilities()
  const client = useQueryClient()
  const toast = useToastManager()
  const isOwner = role === "owner"
  const canEdit = caps.data?.canEditSettings ?? false

  const initial = query.data ? toState(query.data) : null
  const [form, setForm] = useState<FormState | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({})
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
        for (const issue of error.details as Array<{ path?: unknown[]; message?: string }>) {
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
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (query.isError || !current) {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn’t load your settings</AlertTitle>
        <AlertDescription>
          {describeActionError(query.error)}{" "}
          <Button variant="link" size="sm" onClick={() => query.refetch()}>Try again</Button>
        </AlertDescription>
      </Alert>
    )
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm({ ...current, [key]: value })
  }

  // Mirror the server rule: turning approval off needs an owner + explicit consent.
  const consentBlocked = !current.approvalRequired && (!isOwner || !current.directPublishConsent)
  const consentReason = !current.approvalRequired && !isOwner
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
  const canSave = canEdit && isDirty && parsed.success && !consentBlocked && !mutation.isPending

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

  return (
    <form className="flex max-w-2xl flex-col gap-5" onSubmit={onSubmit}>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <label className="flex items-start gap-2 text-ui">
        <Checkbox
          checked={current.approvalRequired}
          disabled={!canEdit}
          onCheckedChange={(value) => set("approvalRequired", value === true)}
        />
        <span>Require approval before replies publish</span>
      </label>

      {current.approvalRequired ? (
        <label className="flex items-start gap-2 text-ui">
          <Checkbox
            checked={current.requireTwoPersonApproval}
            disabled={!canEdit}
            onCheckedChange={(value) => set("requireTwoPersonApproval", value === true)}
          />
          <span>Require a second person to approve each reply</span>
        </label>
      ) : (
        <div className="flex flex-col gap-2 rounded-(--nr-radius-md) border border-warning/40 bg-warning/5 p-3">
          <p className="text-ui font-medium">Replies will publish without approval</p>
          {query.data?.directPublishConsentAt ? (
            <p className="text-caption text-muted-foreground">
              Direct publishing was confirmed on{" "}
              {new Date(query.data.directPublishConsentAt).toLocaleDateString("en-GB")}.
            </p>
          ) : null}
          <label className="flex items-start gap-2 text-ui">
            <Checkbox
              checked={current.directPublishConsent}
              disabled={!isOwner || !canEdit}
              onCheckedChange={(value) => set("directPublishConsent", value === true)}
            />
            <span>I confirm replies may publish to Google without approval.</span>
          </label>
          <GateNote reason={consentReason} />
        </div>
      )}

      <Field error={fieldErrors.rawContentRetentionDays}>
        <FieldLabel>Days to keep raw review content</FieldLabel>
        <Input
          type="number"
          min={1}
          max={30}
          value={current.rawContentRetentionDays}
          disabled={!canEdit}
          aria-label="Days to keep raw review content"
          onChange={(event) => set("rawContentRetentionDays", event.target.value)}
        />
        <FieldError>{fieldErrors.rawContentRetentionDays}</FieldError>
      </Field>

      <Field error={fieldErrors.defaultLanguageCode}>
        <FieldLabel>Default language</FieldLabel>
        <Input
          value={current.defaultLanguageCode}
          disabled={!canEdit}
          aria-label="Default language"
          placeholder="en-GB"
          onChange={(event) => set("defaultLanguageCode", event.target.value)}
        />
        <FieldError>{fieldErrors.defaultLanguageCode}</FieldError>
      </Field>

      <Field error={fieldErrors.defaultTimezone}>
        <FieldLabel>Default timezone</FieldLabel>
        <Select
          value={current.defaultTimezone}
          disabled={!canEdit}
          onValueChange={(value: string | null) => set("defaultTimezone", value ?? current.defaultTimezone)}
        >
          <SelectTrigger aria-label="Default timezone">
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
        <FieldError>{fieldErrors.defaultTimezone}</FieldError>
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSave}>
          {mutation.isPending ? "Saving…" : "Save changes"}
        </Button>
        <GateNote reason={editReason} />
      </div>
    </form>
  )
}
