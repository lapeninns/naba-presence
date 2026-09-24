"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { AgencyNameForm } from "@/components/settings/agency-name-form"
import { TimezonePicker } from "@/components/settings/timezone-picker"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useToastManager } from "@/components/ui/toast"
import { saveSettings } from "@/lib/api/settings"
import { describeActionError } from "@/lib/errors/action-errors"
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
 * `onDirtyChange` tells the wizard a changed timezone has not been saved, so
 * Continue can say so instead of dropping the change.
 */
function StepAgency({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void
}) {
  const settings = useSettings()
  const queryClient = useQueryClient()
  const toast = useToastManager()
  const [timezone, setTimezone] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)

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
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  // Leaving the step clears the wizard's flag with it.
  React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  return (
    <div className="flex max-w-[27.5rem] flex-col gap-6">
      <AgencyNameForm />
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
            Opening hours and report windows are read in this timezone unless a
            listing sets its own.
          </p>
        </div>
        {saveError ? (
          <p role="alert" className="text-ui font-medium text-danger-ink">
            The timezone wasn’t saved. {saveError}
          </p>
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
                toast.add({ title: "Timezone saved" })
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
      </div>
    </div>
  )
}

export { StepAgency }
