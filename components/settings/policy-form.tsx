"use client"

/*
 * SETTINGS SAVE CONTRACT (settings-setup-auth-08). One model per kind of
 * control, the same everywhere in Settings:
 *
 *   - Independent toggles save themselves (autosave): each change is sent
 *     on its own and the row says "Saving…", "Saved" or what went wrong
 *     right beside the control (notification-preferences.tsx).
 *   - A page of fields saved together gets ONE save bar (this file: the
 *     agency or business name and the reply policy). The bar appears with
 *     the first change and stays while saving or after a refused save; a
 *     clean form, or one the person can't edit, shows no bar at all
 *     (settings-setup-auth-07, m1, m2). On a phone it docks to the bottom
 *     edge (the ActionBar's `dock`: the tab bar steps aside); on a desk it
 *     sticks to the foot of the form. One leave guard covers every field.
 *   - A card that is the only editable thing on its page, writing its own
 *     record, saves with its own button at the card's trailing edge, the
 *     inline status ("Unsaved changes", or the error) just before it
 *     (notifications-card.tsx; agency-name-form.tsx in the setup wizard).
 *
 * Success is a toast; a failure stays inline next to the control or button
 * that caused it, and in the bar.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CircleAlert, Eye, Info, PenLine } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useMemo, useRef, useState } from "react"

import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
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
import { cn } from "@/lib/utils"
import { requiresDirectPublishConsent } from "@/lib/contracts/settings"
import { describeActionError } from "@/lib/errors/action-errors"
import { editSettingsDisabledReason } from "@/lib/settings/gating"
import { settingsPolicyFormSchema } from "@/lib/settings/forms/settings-policy"
import { languageLabel, languageOptionsFor } from "@/lib/settings/languages"
import { organisationNameProblem } from "@/components/settings/agency-name-form"
import { SettingsSection } from "@/components/settings/settings-section"
import { TimezonePicker } from "@/components/settings/timezone-picker"
import { renameOrganisation, type SessionResponse } from "@/lib/api/session"
import { ORGANISATION_NAME_MAX } from "@/lib/contracts/session"
import { useSession } from "@/lib/queries/use-session"
import { workspaceTerms } from "@/lib/workspace/terms"
import { DiscardDialog } from "@/components/editors/discard-dialog"
import { StashedEditsNotice } from "@/components/editors/stashed-edits-notice"
import { useDraftKey } from "@/lib/editors/use-draft-key"
import { useKeepFocusClear } from "@/lib/editors/use-keep-focus-clear"
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes"

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

type PolicyDraft = { form: FormState; name: string | null }

/**
 * A stashed policy draft, or null when malformed or no different from what
 * is saved. The direct-publish consent is never restored: it is given by
 * ticking it, not carried over from an earlier visit.
 */
function parsePolicyDraft(
  value: unknown,
  saved: { form: FormState; name: string }
): PolicyDraft | null {
  if (typeof value !== "object" || value === null) return null
  const { form, name } = value as Record<string, unknown>
  if (typeof form !== "object" || form === null) return null
  if (name !== null && typeof name !== "string") return null
  const restored = { ...saved.form }
  for (const key of Object.keys(saved.form) as (keyof FormState)[]) {
    const field = (form as Record<string, unknown>)[key]
    if (typeof field !== typeof saved.form[key]) return null
    Object.assign(restored, { [key]: field })
  }
  restored.directPublishConsent = false
  const changed =
    (name !== null && name.trim() !== saved.name) ||
    (Object.keys(saved.form) as (keyof FormState)[]).some(
      (key) => restored[key] !== saved.form[key]
    )
  return changed ? { form: restored, name } : null
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
  const session = useSession()
  const client = useQueryClient()
  const router = useRouter()
  const toast = useToastManager()
  const formRef = useRef<HTMLFormElement>(null)
  // Keyboard safety for the docked save bar, as the editors and the setup
  // wizard have it: the browser only scrolls a focused field it thinks is
  // off screen, and with a phone keyboard up a field above the keyboard can
  // still sit under the bar. The form mounts after the loading states, so
  // the hook follows it through a callback ref.
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null)
  const keepClearRoot = useMemo(() => ({ current: formElement }), [formElement])
  useKeepFocusClear(keepClearRoot, "[data-slot=action-bar]")
  // Stable, so React doesn't detach and reattach it on every render.
  const setFormRef = useCallback((node: HTMLFormElement | null) => {
    formRef.current = node
    setFormElement(node)
  }, [])
  const isOwner = role === "owner"
  const canEdit = caps.data?.canEditSettings ?? false
  const readOnly = caps.data !== undefined && !canEdit

  // The account's name, saved by the same bar as the policy (finding m1):
  // only an owner can rename (PATCH /api/organisations checks again), so for
  // anyone else it is read-only and never makes the page dirty.
  const sessionUser = session.data?.session
  const terms = workspaceTerms(sessionUser?.workspaceMode ?? "agency")
  const savedName = sessionUser?.organisationName ?? ""
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const nameValue = nameDraft ?? savedName
  const nameDirty =
    isOwner && nameDraft !== null && nameDraft.trim() !== savedName
  const nameProblem = nameDirty
    ? organisationNameProblem(nameValue, terms)
    : null

  const initial = query.data ? toState(query.data) : null
  const [form, setForm] = useState<FormState | null>(null)
  const [serverErrors, setServerErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({})
  const [formError, setFormError] = useState<string | null>(null)
  const current = form ?? initial

  const policyChanged = useMemo(() => {
    if (!current || !initial) return []
    const keys = (Object.keys(current) as (keyof FormState)[]).filter(
      (key) => current[key] !== initial[key]
    )
    return [...new Set(keys.map((key) => CHANGE_LABELS[key]))]
  }, [current, initial])
  const policyDirty = policyChanged.length > 0
  const changed = nameDirty ? ["Name", ...policyChanged] : policyChanged
  const isDirty = changed.length > 0

  // Arms beforeunload while dirty (spec §6) and keeps the edits through a
  // forced sign-out, offering them back on the next visit; an in-app link
  // or the back button asks first.
  const draftKey = useDraftKey({
    resource: "settings-policy",
    schemaVersion: 2,
  })
  const unsaved = useUnsavedChanges<PolicyDraft>({
    scope: draftKey,
    isDirty,
    restore: {
      snapshot: () => ({
        form: current ?? ({} as FormState),
        name: nameDraft,
      }),
      parse: (value) =>
        initial
          ? parsePolicyDraft(value, { form: initial, name: savedName })
          : null,
      // Judged against the saved policy, and only by someone who may edit it.
      ready: initial !== null && canEdit,
    },
  })

  const mutation = useMutation({
    mutationFn: (input: SettingsPatchInput) => saveSettings(input),
    onSuccess: async (settings) => {
      setForm(toState(settings))
      setServerErrors({})
      setFormError(null)
      await client.invalidateQueries({ queryKey: queryKeys.settings })
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

  // The same write, cache update and refresh as the wizard's name card
  // (agency-name-form.tsx): the sidebar reads the name from the cached
  // session, and server components still hold the old one.
  const rename = useMutation({
    mutationFn: (name: string) => renameOrganisation(name),
    onSuccess: (organisation) => {
      client.setQueryData<SessionResponse>(queryKeys.session, (old) =>
        old?.session
          ? { session: { ...old.session, organisationName: organisation.name } }
          : old
      )
      void client.invalidateQueries({ queryKey: ["organisations"] })
      setNameDraft(null)
      setNameError(null)
      router.refresh()
    },
    onError: (error) => setNameError(describeActionError(error)),
  })
  const saving = mutation.isPending || rename.isPending

  if (query.isPending || query.isError || !current) {
    return (
      <QueryStates
        status={queryStatus(query)}
        pending={<PolicySkeleton />}
        error={{
          title: "We couldn’t load your settings",
          description: `${describeActionError(query.error)} Your current policy is still in force; nothing was changed.`,
        }}
        onRetry={() => void query.refetch()}
      />
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
  // The policy half is checked only when it changed: an owner renaming the
  // workspace isn't held up by a policy they didn't touch.
  const policyBlocked = policyDirty && (!parsed.success || consentBlocked)
  const canSave =
    isDirty &&
    (!policyDirty || canEdit) &&
    !policyBlocked &&
    nameProblem === null &&
    !saving

  const saveBlockedReason = !isDirty
    ? null
    : (policyDirty && !parsed.success) || nameProblem
      ? "Fix the marked fields to save."
      : policyDirty && consentBlocked
        ? isOwner
          ? "Tick the confirmation to publish without approval."
          : "Turning approval off needs an owner."
        : null

  // One press saves whatever changed: the policy (PUT /api/settings) and
  // the name (PATCH /api/organisations), each with its own unchanged body.
  // Each half reports its own refusal; the toast only says "saved" when
  // everything that was sent was saved.
  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    const writes: Promise<unknown>[] = []
    if (policyDirty && parsed.success) {
      writes.push(
        mutation.mutateAsync({
          approvalRequired: parsed.data.approvalRequired,
          requireTwoPersonApproval: parsed.data.requireTwoPersonApproval,
          rawContentRetentionDays: parsed.data.rawContentRetentionDays,
          defaultLanguageCode: parsed.data.defaultLanguageCode,
          defaultTimezone: parsed.data.defaultTimezone,
          directPublishConsent: parsed.data.directPublishConsent,
        })
      )
    }
    if (nameDirty) {
      setNameError(null)
      writes.push(rename.mutateAsync(nameValue.trim()))
    }
    const results = await Promise.allSettled(writes)
    if (results.every((result) => result.status === "fulfilled")) {
      toast.add({ title: "Settings saved", type: "success" })
      // The bar (and the Save button that had focus) goes with the last
      // unsaved change; keep focus in the form rather than dropping it on
      // the page body.
      formRef.current?.focus({ preventScroll: true })
    }
  }

  const discard = () => {
    setForm(null)
    setServerErrors({})
    setFormError(null)
    setNameDraft(null)
    setNameError(null)
  }

  // The bar is there only while there is something to say: unsaved edits,
  // a save on its way, or a refused save. Never for someone who can't edit
  // (the read-only note above says why), never pinned over a clean form.
  const barError =
    formError ?? (nameError ? `${terms.orgName}: ${nameError}` : null)
  const showBar = !readOnly && (isDirty || saving || barError !== null)
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
      ref={setFormRef}
      aria-label="Reply policy"
      // Focus lands here after a save takes the bar away; it is never a
      // Tab stop of its own.
      tabIndex={-1}
      // While the bar is up, a field focused near the foot of the page
      // scrolls clear of it rather than under it (WCAG 2.4.11).
      className={cn(
        "flex flex-col gap-(--np-gap-section) outline-none",
        showBar && "[&_:focus]:scroll-mb-24"
      )}
      onSubmit={(event) => void onSubmit(event)}
      noValidate
    >
      {unsaved.stashed ? (
        <StashedEditsNotice
          noun="this page"
          onRestore={() => {
            const restored = unsaved.restoreStashed()
            if (!restored) return
            setForm(restored.form)
            if (isOwner && restored.name !== null) setNameDraft(restored.name)
          }}
          onDismiss={unsaved.dismissStashed}
        />
      ) : null}
      {readOnly ? (
        <Alert variant="info" icon={<Eye strokeWidth={1.75} aria-hidden />}>
          <AlertTitle>You can look, but not change this</AlertTitle>
          <AlertDescription>
            <span>{editReason}</span> Ask one of them if something here needs to
            change.
          </AlertDescription>
        </Alert>
      ) : null}

      <SettingsSection
        id="settings-org-name"
        title={terms.org}
        description="The name your team and invited people see."
        variant="group"
      >
        <Field error={nameError ?? nameProblem ?? undefined}>
          <FieldLabel>{terms.orgName}</FieldLabel>
          <Input
            value={nameValue}
            readOnly={!isOwner}
            maxLength={ORGANISATION_NAME_MAX}
            autoComplete="organization"
            onChange={(event) => {
              setNameError(null)
              setNameDraft(event.target.value)
            }}
          />
          <FieldDescription>
            {isOwner
              ? "What your team sees in the sidebar and what invitations say they are joining."
              : `Only an owner can rename the ${terms.orgLower}.`}
          </FieldDescription>
          <FieldError>{nameError ?? nameProblem}</FieldError>
        </Field>
      </SettingsSection>

      <SettingsSection
        id="settings-approval"
        title="Approval"
        description="Who has to look at a reply before it goes to Google."
        variant="group"
        contentClassName="gap-4"
      >
        <Switch
          label="Require approval before replies publish"
          description="Replies from people who can’t publish wait in the Approval queue for someone who can."
          labelClassName="items-start"
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

        <Consequence>{consequence}</Consequence>

        {current.approvalRequired ? (
          <Switch
            label="Require a second person to approve each reply"
            description="The person who asked for approval can’t approve their own reply."
            labelClassName="items-start"
            checked={current.requireTwoPersonApproval}
            disabled={!canEdit}
            onCheckedChange={(value) => set("requireTwoPersonApproval", value)}
          />
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
      </SettingsSection>

      <SettingsSection
        id="settings-retention"
        title="Raw review content retention"
        description="How long we keep the customer’s review text after it arrives."
        variant="group"
      >
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
      </SettingsSection>

      <SettingsSection
        id="settings-defaults"
        title="Defaults"
        description="What new replies and schedules start from."
        variant="group"
        contentClassName="grid grid-cols-1 gap-4 @[36rem]:grid-cols-2"
      >
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
            <SelectContent title="Default language">
              {languageOptionsFor(current.defaultLanguageCode).map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.label}
                </SelectItem>
              ))}
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
            Opening hours and report windows are read in this timezone unless a
            listing sets its own.
          </FieldDescription>
          <FieldError>{fieldError("defaultTimezone")}</FieldError>
        </Field>
      </SettingsSection>

      <ActionBar
        label="Save reply policy"
        // Only while there is something to save, a save on its way or a
        // refused save (`showBar`). Docked to a phone's bottom edge (the
        // tab bar steps aside and the page's scroll padding follows it),
        // riding above the on-screen keyboard; stuck to the foot of the
        // form on a desk.
        dock
        visible={showBar}
        offset="md:bottom-3"
        status={
          barError && !saving ? (
            <>
              <CircleAlert aria-hidden />
              <span>
                <strong className="font-semibold">Not saved</strong> ·{" "}
                <ActionBarMuted>
                  {barError} Your edits are still here.
                </ActionBarMuted>
              </span>
            </>
          ) : (
            <>
              <PenLine aria-hidden />
              <span>
                <strong className="font-semibold">
                  {saving
                    ? "Saving"
                    : `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}`}
                </strong>
                {changed.length > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <ActionBarMuted>
                      {saveBlockedReason ?? changed.join(", ")}
                    </ActionBarMuted>
                  </>
                ) : null}
              </span>
            </>
          )
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost-dark"
              disabled={!isDirty || saving}
              onClick={discard}
            >
              Discard
            </Button>
            <Button
              type="submit"
              disabled={!canSave && !saving}
              pending={saving}
              pendingLabel="Saving…"
            >
              Save changes
            </Button>
          </>
        }
      />
      <DiscardDialog
        {...unsaved.leavePrompt}
        title="Leave without saving?"
        confirmLabel="Leave and discard"
        announce={false}
        description="Your changes on this page aren’t saved. Leaving throws them away; the current name and policy stay in force."
      />
    </form>
  )
}
