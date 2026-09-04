"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToastManager } from "@/components/ui/toast"
import { describeActionError } from "@/lib/errors/action-errors"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { saveSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/queries/keys"
import { useSession } from "@/lib/queries/use-session"
import { useSettings } from "@/lib/queries/use-settings"

// The zones an agency in this market actually works in. A full IANA list is a
// 400-row dropdown that helps nobody pick.
const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Madrid",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
]

/**
 * Confirms the agency's own details before any client work.
 *
 * The name is read-only here: it came from sign-up and renaming it is an
 * account action, not part of onboarding a client. The timezone is not — it
 * decides how opening hours and report windows are interpreted, and getting it
 * wrong is invisible until a report looks wrong.
 */
function StepAgency() {
  const session = useSession()
  const settings = useSettings()
  const queryClient = useQueryClient()
  const toast = useToastManager()
  const [timezone, setTimezone] = React.useState<string | null>(null)

  // The settings PATCH takes the whole policy object, so the current values
  // ride along unchanged; sending only the timezone would clear the rest.
  const existing = settings.data
  const save = useMutation({
    mutationFn: (defaultTimezone: string) =>
      saveSettings({
        approvalRequired: existing?.approvalRequired ?? true,
        rawContentRetentionDays: existing?.rawContentRetentionDays ?? 30,
        defaultLanguageCode: existing?.defaultLanguageCode ?? "en",
        defaultTimezone,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  })

  const saved = settings.data?.defaultTimezone
  const current = timezone ?? saved ?? "Europe/London"
  const dirty = saved !== undefined && current !== saved

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="setup-agency-name">Agency</Label>
        <Input
          id="setup-agency-name"
          value={session.data?.session?.organisationName ?? ""}
          readOnly
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="setup-agency-timezone">Default timezone</Label>
        <Select value={current} onValueChange={(value) => setTimezone(String(value))}>
          <SelectTrigger id="setup-agency-timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone.replace("_", " ").replace("/", " · ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-caption text-ink-muted">
          Opening hours and report windows are read in this timezone unless a
          location sets its own.
        </p>
      </div>
      <div>
        <Button
          disabled={!dirty || save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync(current)
              toast.add({ title: "Timezone saved" })
            } catch (error) {
              toast.add({
                title: "Could not save",
                description: describeActionError(error),
              })
            }
          }}
        >
          {save.isPending ? "Saving…" : "Save timezone"}
        </Button>
      </div>
    </div>
  )
}

export { StepAgency }
