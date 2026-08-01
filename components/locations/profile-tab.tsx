"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"

import { CanonicalDiff, type DiffStatus } from "@/components/locations/canonical-diff"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import {
  runProfileOperation,
  saveProfile,
  type ProfileFieldKey,
  type ProfileState,
} from "@/lib/api/location-profile"
import { describeActionError } from "@/lib/locations/action-errors"
import { profileFormSchema, toProfileValues, type ProfileFormValues } from "@/lib/locations/forms/profile"
import { editDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useProfile } from "@/lib/queries/use-location-profile"

const FIELD_LABELS: Record<ProfileFieldKey, string> = {
  name: "Business name",
  description: "Description",
  phone: "Phone",
  address: "Address",
  mapsUrl: "Google Maps link",
  reviewUrl: "Review link",
  website: "Website",
}
const EDITABLE: ProfileFieldKey[] = ["name", "description", "phone", "website"]

// Server zod errors on the PUT body arrive under path ["values", <field>]; map
// them back to form fields (mirrors lib/api/auth-errors.ts fieldErrorsFrom,
// adapted for the nested `values` body). Spec §6 "server details map to fields".
function serverFieldErrors(error: unknown): Partial<Record<keyof ProfileFormValues, string>> {
  if (!(error instanceof ApiClientError) || error.code !== "invalid_request" || !Array.isArray(error.details)) return {}
  const fields: Partial<Record<keyof ProfileFormValues, string>> = {}
  for (const issue of error.details) {
    const path = (issue as { path?: unknown[] }).path
    const message = (issue as { message?: unknown }).message
    const key = Array.isArray(path) ? String(path[path.length - 1] ?? "") : ""
    if ((key === "name" || key === "description" || key === "phone" || key === "website") && typeof message === "string" && !(key in fields)) {
      fields[key as keyof ProfileFormValues] = message
    }
  }
  return fields
}

export function ProfileTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const profileQuery = useProfile(locationId)
  const capsQuery = useLocationCapabilities(locationId)
  const caps = capsQuery.data

  if (profileQuery.isPending) return <TabLoading />
  if (profileQuery.isError) return <TabError error={profileQuery.error} onRetry={() => profileQuery.refetch()} />

  return (
    <ProfileTabLoaded
      locationId={locationId}
      profile={profileQuery.data}
      caps={caps}
      invalidate={() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.locationProfile(locationId) })
      }}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function ProfileTabLoaded({
  locationId,
  profile,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  profile: ProfileState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const byKey = useMemo(() => new Map(profile.fields.map((f) => [f.key, f])), [profile.fields])
  const initial: ProfileFormValues = useMemo(
    () => ({
      name: byKey.get("name")?.canonicalValue ?? "",
      description: byKey.get("description")?.canonicalValue ?? "",
      phone: byKey.get("phone")?.canonicalValue ?? "",
      website: byKey.get("website")?.canonicalValue ?? "",
    }),
    [byKey]
  )
  const [values, setValues] = useState<ProfileFormValues>(initial)
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileFormValues, string>>>({})
  const revision = profile.canonicalResource.revision
  // Deviation from the brief's reference impl (`useEffect(() => setValues(initial), [...])`
  // — a bare setState effect body): react-hooks/set-state-in-effect flags an
  // effect whose body is nothing but a synchronous setState call. Mirrors the
  // ref-guard convention already used by components/inbox/reply-composer.tsx —
  // only reset local edits when the canonical revision actually advances
  // (e.g. after a successful save/publish/import invalidates + refetches),
  // not on every incidental re-render of `initial`.
  const revisionRef = useRef(revision)
  useEffect(() => {
    if (revisionRef.current === revision) return
    revisionRef.current = revision
    setValues(initial)
  }, [initial, revision])

  const isDirty = JSON.stringify(values) !== JSON.stringify(initial)
  useDirtyGuard({ key: `location-profile-${locationId}`, isDirty, snapshot: () => JSON.stringify(values) })

  const [publishOpen, setPublishOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // Derived before the mutations that close over them (no use-before-define).
  // Publish (to Google) only pushes the bidirectional fields; import (from
  // Google) may pull any non-read-only field, incl. import_only ones the server
  // permits (address / mapsUrl / reviewUrl) — see profile.ts assertSelectedFields.
  const driftedEditable = profile.fields.filter((f) => EDITABLE.includes(f.key) && f.status !== "in_sync")
  const driftedImport = profile.fields.filter((f) => f.policy !== "google_read_only" && f.status !== "in_sync")
  const publishFields = driftedEditable.map((f) => f.key)
  const importFields = driftedImport.map((f) => f.key)
  const publishNeedsAck = driftedEditable.some((f) => f.status === "google_dirty" || f.status === "conflict")
  const importNeedsAck = driftedImport.some((f) => f.status === "core_dirty" || f.status === "conflict")

  const save = useMutation({
    mutationFn: (input: { expectedCanonicalRevision: string; values: ReturnType<typeof toProfileValues> }) => saveProfile(locationId, input),
    onSuccess: () => {
      invalidate()
      toast("Profile saved", "success")
    },
    onError: (error) => {
      const fieldErrors = serverFieldErrors(error)
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors)
        return
      }
      toast(describeActionError(error), "error")
    },
  })

  const publish = useMutation({
    mutationFn: (confirmOverwrite: boolean) =>
      runProfileOperation(locationId, {
        direction: "to_google",
        confirmation: "publish_nabapresence_profile_to_google",
        selectedFields: publishFields,
        expectedCanonicalRevision: revision,
        expectedCanonicalHash: profile.canonicalHash,
        expectedGoogleHash: profile.googleHash,
        confirmOverwriteGoogleChanges: confirmOverwrite,
      }),
    onSuccess: () => {
      setPublishOpen(false)
      invalidate()
      toast("Profile published to Google", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  const importOp = useMutation({
    mutationFn: (confirmOverwrite: boolean) =>
      runProfileOperation(locationId, {
        direction: "from_google",
        confirmation: "import_google_profile_to_nabapresence",
        selectedFields: importFields,
        expectedCanonicalRevision: revision,
        expectedCanonicalHash: profile.canonicalHash,
        expectedGoogleHash: profile.googleHash,
        confirmOverwriteCanonicalChanges: confirmOverwrite,
      }),
    onSuccess: () => {
      setImportOpen(false)
      invalidate()
      toast("Imported details from Google", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  function submit() {
    const parsed = profileFormSchema.safeParse(values)
    if (!parsed.success) {
      const next: Partial<Record<keyof ProfileFormValues, string>> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === "string") next[key as keyof ProfileFormValues] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    save.mutate({ expectedCanonicalRevision: revision, values: toProfileValues(parsed.data) })
  }

  const editReason = editDisabledReason(caps)
  // Profile publish/import are owner/admin-gated at the route, so they use the
  // edit gate rather than the publish gate; publish also needs Google writes on.
  const publishReason = editReason ?? (!profile.googleWritesEnabled ? "Publishing to Google is currently unavailable." : publishFields.length === 0 ? "Everything is already in sync with Google." : null)
  const importReason = editReason ?? (importFields.length === 0 ? "There are no Google changes to import." : null)

  const diffRows = profile.fields.map((f) => ({
    key: f.key,
    label: FIELD_LABELS[f.key],
    canonicalValue: f.canonicalValue,
    googleValue: f.googleValue,
    status: f.status as DiffStatus,
  }))

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">NabaPresence vs Google</h2>
        <CanonicalDiff rows={diffRows} />
      </section>

      <section className="flex max-w-xl flex-col gap-4">
        <h2 className="text-title font-semibold">Edit details</h2>
        <Field error={errors.name}>
          <FieldLabel>Business name</FieldLabel>
          <Input value={values.name} onChange={(event) => setValues((v) => ({ ...v, name: event.target.value }))} disabled={Boolean(editReason)} />
          <FieldError />
        </Field>
        <Field error={errors.description}>
          <FieldLabel>Description</FieldLabel>
          <Textarea value={values.description} onChange={(event) => setValues((v) => ({ ...v, description: event.target.value }))} disabled={Boolean(editReason)} rows={4} />
          <FieldError />
        </Field>
        <Field error={errors.phone}>
          <FieldLabel>Phone</FieldLabel>
          <Input value={values.phone} onChange={(event) => setValues((v) => ({ ...v, phone: event.target.value }))} disabled={Boolean(editReason)} />
          <FieldError />
        </Field>
        <Field error={errors.website}>
          <FieldLabel>Website</FieldLabel>
          <Input value={values.website} onChange={(event) => setValues((v) => ({ ...v, website: event.target.value }))} disabled={Boolean(editReason)} inputMode="url" />
          <FieldError />
        </Field>
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={Boolean(editReason) || !isDirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
        <GateNote reason={editReason} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Sync with Google</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setPublishOpen(true)} disabled={Boolean(publishReason) || publish.isPending}>
            Publish to Google
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)} disabled={Boolean(importReason) || importOp.isPending}>
            Import from Google
          </Button>
        </div>
        {/* Deviation from the brief's reference impl (test wins, see task-5
            report): when editReason is set, publishReason === editReason
            (the `??` short-circuits), so unconditionally rendering GateNote
            here would duplicate "Only owners and admins can edit this
            location." — already shown once under "Edit details" — and the
            pinned viewer test's singular `getByText(...)` fails on the
            duplicate. Suppress this note whenever the edit gate already
            explains it; only show a publish-specific reason otherwise. */}
        <GateNote reason={editReason ? null : publishReason} />
      </section>

      <OverwriteConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish these details to Google?"
        description={`This updates ${publishFields.map((k) => FIELD_LABELS[k]).join(", ")} on your Google Business Profile.`}
        confirmLabel="Publish"
        requireAcknowledgement={publishNeedsAck}
        acknowledgementLabel="Google changed some of these fields independently. Overwrite them with your NabaPresence details."
        pending={publish.isPending}
        onConfirm={() => publish.mutate(publishNeedsAck)}
      />
      <OverwriteConfirmDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import these details from Google?"
        description={`This replaces ${importFields.map((k) => FIELD_LABELS[k]).join(", ")} in NabaPresence with the values from Google.`}
        confirmLabel="Import"
        requireAcknowledgement={importNeedsAck}
        acknowledgementLabel="You have unsaved NabaPresence changes to some of these fields. Overwrite them with Google’s values."
        pending={importOp.isPending}
        onConfirm={() => importOp.mutate(importNeedsAck)}
      />
    </div>
  )
}
