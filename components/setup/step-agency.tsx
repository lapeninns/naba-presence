"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { DiscardDialog } from "@/components/editors/discard-dialog"
import { AgencyNameForm } from "@/components/settings/agency-name-form"
import { TimezonePicker } from "@/components/settings/timezone-picker"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { showToast, useToastManager } from "@/components/ui/toast"
import { saveSettings } from "@/lib/api/settings"
import { useDraftKey } from "@/lib/editors/use-draft-key"
import { describeActionError } from "@/lib/errors/action-errors"
import { useUnsavedChanges } from "@/lib/hooks/use-unsaved-changes"
import { queryKeys } from "@/lib/queries/keys"
import { useSettings } from "@/lib/queries/use-settings"

/**
 * Confirms the agency's own details before any client work.
 *
 * Sign-up stores a placeholder name, so an owner can put the real one in
 * here (everyone else sees it read-only). The timezone decides how opening
 * hours and report windows are interpreted, and getting it wrong is
 * invisible until a report looks wrong.
 *
 * The name and the timezone save separately, and both are guarded the same
 * way: `onDirtyChange` tells the wizard which of them has not been saved, so
 * Continue can say so instead of dropping the change, and a link or the back
 * button asks first (the name form's own guard, and the timezone's here).
 */
type AgencyUnsaved = { name: boolean; timezone: boolean }

function StepAgency({
  onDirtyChange,
}: {
  onDirtyChange?: (unsaved: AgencyUnsaved) => void
}) {
  const settings = useSettings()
  const queryClient = useQueryClient()
  const toast = useToastManager()
  const [timezone, setTimezone] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [nameDirty, setNameDirty] = React.useState(false)

  // The settings PATCH takes the whole policy object, so the current values
  // ride along unchanged; sending only the timezone would clear the rest.
  // Saving waits for them to load rather than guessing, since a guessed
  // `approvalRequired` could quietly change the reply policy.
  const existing = settings.data
  const save = useMutation({
    mutationFn: (defaultTimezone: string) => {
      if (!existing) throw new Error("Your settings are still loading.")
      return saveSettings({
        approvalRequired: existing.approvalRequired,
        requireTwoPersonApproval: existing.requireTwoPersonApproval,
        rawContentRetentionDays: existing.rawContentRetentionDays,
        defaultLanguageCode: existing.defaultLanguageCode,
        defaultTimezone,
      })
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  })

  const saved = existing?.defaultTimezone
  const current = timezone ?? saved ?? "Europe/London"
  const dirty = saved !== undefined && current !== saved

  React.useEffect(() => {
    onDirtyChange?.({ name: nameDirty, timezone: dirty })
  }, [nameDirty, dirty, onDirtyChange])
  // Leaving the step clears the wizard's flags with it.
  React.useEffect(
    () => () => onDirtyChange?.({ name: false, timezone: false }),
    [onDirtyChange]
  )
  // As the name form does: a reload warns, and a link (the rail, "Finish
  // later") or the back button asks before an unsaved timezone is dropped.
  const draftKey = useDraftKey({ resource: "setup-timezone", schemaVersion: 1 })
  const unsaved = useUnsavedChanges({ scope: draftKey, isDirty: dirty })

  return (
    <div className="flex max-w-md flex-col gap-6">
      <AgencyNameForm onDirtyChange={setNameDirty} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-agency-timezone" className="font-semibold">
            Default timezone
          </Label>
          <TimezonePicker
            id="setup-agency-timezone"
            aria-describedby="setup-agency-timezone-hint"
            value={current}
            disabled={!existing}
            onChange={(zone) => {
              setSaveError(null)
              setTimezone(zone)
            }}
          />
          <p
            id="setup-agency-timezone-hint"
            className="text-caption text-ink-muted"
          >
            Reports and daily digests are read in this timezone.
          </p>
        </div>
        {saveError ? (
          <FormError>The timezone wasn’t saved. {saveError}</FormError>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            id="setup-agency-save"
            variant="secondary"
            disabled={!dirty}
            pending={save.isPending}
            pendingLabel="Saving…"
            onClick={async () => {
              setSaveError(null)
              try {
                await save.mutateAsync(current)
                // A local setting, not a Google write: the outcome toast's
                // local kind (no Undo is offered; the field itself reverts).
                showToast({ title: "Timezone saved", kind: "local" }, toast)
              } catch (error) {
                setSaveError(describeActionError(error))
              }
            }}
          >
            Save timezone
          </Button>
          <span className="text-caption text-ink-muted" role="status">
            {saved === undefined ? "" : dirty ? "Unsaved change" : "Saved"}
          </span>
        </div>
        <DiscardDialog
          {...unsaved.leavePrompt}
          title="Leave without saving the timezone?"
          confirmLabel="Leave and discard"
          announce={false}
          description="The new timezone isn’t saved. Leaving keeps the current one."
        />
      </div>
    </div>
  )
}

export { StepAgency, type AgencyUnsaved }
