"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { HoursEditor } from "@/components/locations/hours-editor"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { publishHours, saveHours, type HoursState, type NormalizedHours } from "@/lib/api/location-hours"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/locations/action-errors"
import { hoursFormSchema } from "@/lib/locations/forms/hours"
import { editDisabledReason, resourceDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useHours } from "@/lib/queries/use-location-hours"

const STATUS_COPY: Record<HoursState["status"], string> = {
  in_sync: "In sync with Google",
  core_dirty: "You have unpublished changes",
  google_dirty: "Google changed independently",
  conflict: "Both sides changed — review before publishing",
}

export function HoursTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const hoursQuery = useHours(locationId)
  const caps = useLocationCapabilities(locationId).data

  if (hoursQuery.isPending) return <TabLoading />
  if (hoursQuery.isError) return <TabError error={hoursQuery.error} onRetry={() => hoursQuery.refetch()} />

  const hours = hoursQuery.data
  return (
    <HoursTabLoaded
      key={hours.canonicalResource.revision}
      locationId={locationId}
      hours={hours}
      caps={caps}
      invalidate={() => void queryClient.invalidateQueries({ queryKey: queryKeys.locationHours(locationId) })}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function HoursTabLoaded({
  locationId,
  hours,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  hours: HoursState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [draft, setDraft] = useState<NormalizedHours>(hours.canonical)
  // Deviation from the brief's reference impl (`useEffect(() => setDraft(hours.canonical),
  // [hours.canonical])` — a bare setState effect body): react-hooks/set-state-in-effect
  // flags an effect whose body is nothing but a synchronous setState call. Mirrors the
  // ref-guard convention already used by components/locations/profile-tab.tsx (see
  // task-5-report.md) — only reset local edits when the canonical revision actually
  // advances (e.g. after a successful save/publish invalidates + refetches), not on
  // every incidental re-render of `hours.canonical`.
  const revision = hours.canonicalResource.revision
  const revisionRef = useRef(revision)
  useEffect(() => {
    if (revisionRef.current === revision) return
    revisionRef.current = revision
    setDraft(hours.canonical)
  }, [hours.canonical, revision])
  const [publishOpen, setPublishOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(hours.canonical)
  useDirtyGuard({ key: `location-hours-${locationId}`, isDirty, snapshot: () => JSON.stringify(draft) })

  const save = useMutation({
    mutationFn: () => saveHours(locationId, { expectedCanonicalRevision: hours.canonicalResource.revision, hours: draft }),
    onSuccess: () => {
      setFormError(null)
      invalidate()
      toast("Opening hours saved", "success")
    },
    // Nested per-field mapping is impractical for the weekly structure, so server
    // errors surface in the form-level Alert (plus a toast). Carry-forward noted.
    onError: (error) => {
      setFormError(describeActionError(error))
      toast(describeActionError(error), "error")
    },
  })

  const publish = useMutation({
    mutationFn: (confirmOverwrite: boolean) =>
      publishHours(locationId, {
        expectedCanonicalRevision: hours.canonicalResource.revision,
        expectedCanonicalHash: hours.canonicalHash,
        expectedGoogleHash: hours.googleHash,
        approvedUpdateMask: hours.updateMask,
        confirmOverwriteGoogleChanges: confirmOverwrite,
      }),
    onSuccess: () => {
      setPublishOpen(false)
      setFormError(null)
      invalidate()
      toast("Opening hours published to Google", "success")
    },
    onError: (error) => {
      setFormError(describeActionError(error))
      toast(describeActionError(error), "error")
    },
  })

  function submit() {
    const parsed = hoursFormSchema.safeParse(draft)
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please check the opening hours.")
      return
    }
    setFormError(null)
    save.mutate()
  }

  const editReason = editDisabledReason(caps)
  const needsAck = hours.status === "google_dirty" || hours.status === "conflict"
  const publishReason =
    resourceDisabledReason(caps, "hours", hours.writesEnabled) ?? (hours.status === "in_sync" ? "Opening hours already match Google." : isDirty ? "Save your changes before publishing." : null)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={hours.status === "in_sync" ? "secondary" : "warning"}>{STATUS_COPY[hours.status]}</Badge>
        <span className="text-caption text-muted-foreground">Times shown in {hours.location.timezone}.</span>
      </div>

      {hours.warnings.map((warning) => (
        <Alert key={warning} variant="warning">
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      <HoursEditor value={draft} onChange={setDraft} disabled={Boolean(editReason)} />

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={Boolean(editReason) || !isDirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="outline" onClick={() => setPublishOpen(true)} disabled={Boolean(publishReason) || publish.isPending}>
          Publish to Google
        </Button>
      </div>
      <GateNote reason={editReason ?? publishReason} />

      <OverwriteConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish opening hours to Google?"
        description="This updates the opening hours on your Google Business Profile to match NabaPresence."
        confirmLabel="Publish"
        requireAcknowledgement={needsAck}
        acknowledgementLabel="Google changed the opening hours independently. Overwrite them with the NabaPresence schedule."
        pending={publish.isPending}
        onConfirm={() => publish.mutate(needsAck)}
      />
    </div>
  )
}
