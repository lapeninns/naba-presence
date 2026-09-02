"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { CanonicalDiff, type DiffStatus } from "@/components/locations/canonical-diff"
import { ImportReviewPanel } from "@/components/locations/import-review-panel"
import { LocationTab } from "@/components/locations/location-tab"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ApiClientError } from "@/lib/api/client"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import {
  runProfileOperation,
  saveProfile,
  type ProfileFieldKey,
  type ProfileState,
} from "@/lib/api/location-profile"
import { describeActionError } from "@/lib/errors/action-errors"
import { profileFormSchema, toProfileValues, type ProfileFormValues } from "@/lib/locations/forms/profile"
import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"
import { queryKeys } from "@/lib/queries/keys"
import { useProfile } from "@/lib/queries/use-location-profile"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

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

type FieldErrors = Partial<Record<keyof ProfileFormValues, string>>

// Server zod errors on the PUT body arrive under path ["values", <field>]; map
// them back to form fields (mirrors lib/api/auth-errors.ts fieldErrorsFrom,
// adapted for the nested `values` body). Spec §6 "server details map to fields".
function serverFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiClientError) || error.code !== "invalid_request" || !Array.isArray(error.details)) return {}
  const fields: FieldErrors = {}
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
  return (
    <LocationTab locationId={locationId} useResource={useProfile}>
      {({ data: profile, editReason }) => (
        <ProfileForm locationId={locationId} profile={profile} editReason={editReason} />
      )}
    </LocationTab>
  )
}

function ProfileForm({
  locationId,
  profile,
  editReason,
}: {
  locationId: string
  profile: ProfileState
  editReason: string | null
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
  const revision = profile.canonicalResource.revision
  const [values, setValues] = useResetOnRevision(initial, revision)
  const [errors, setErrors] = useState<FieldErrors>({})

  const isDirty = JSON.stringify(values) !== JSON.stringify(initial)
  useDirtyGuard({ key: `location-profile-${locationId}`, isDirty, snapshot: () => JSON.stringify(values) })

  const [publishOpen, setPublishOpen] = useState(false)

  // Publish (to Google) only pushes the bidirectional fields. Import (from
  // Google) is handled per-field by the ImportReviewPanel suggestions queue,
  // which replaced the all-or-nothing bulk import button (the API remains).
  const driftedEditable = profile.fields.filter((f) => EDITABLE.includes(f.key) && f.status !== "in_sync")
  const publishFields = driftedEditable.map((f) => f.key)
  const publishNeedsAck = driftedEditable.some((f) => f.status === "google_dirty" || f.status === "conflict")

  const save = useResourceMutation({
    mutationFn: (input: { expectedCanonicalRevision: string; values: ReturnType<typeof toProfileValues> }) => saveProfile(locationId, input),
    invalidate: [queryKeys.locationProfile(locationId)],
    successToast: "Profile saved",
    // A server validation error maps onto the fields; the toast then repeats
    // the first field message rather than a generic failure.
    errorToast: (error) => Object.values(serverFieldErrors(error))[0] ?? describeActionError(error),
    onError: (error) => {
      const fieldErrors = serverFieldErrors(error)
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors)
    },
  })

  const publish = useResourceMutation({
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
    invalidate: [queryKeys.locationProfile(locationId)],
    successToast: "Profile published to Google",
    onSuccess: () => setPublishOpen(false),
  })

  function submit() {
    const parsed = profileFormSchema.safeParse(values)
    if (!parsed.success) {
      const next: FieldErrors = {}
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

  // Profile publish/import are owner/admin-gated at the route, so they use the
  // edit gate rather than the publish gate; publish also needs Google writes on.
  const publishReason = editReason ?? (!profile.googleWritesEnabled ? "Publishing to Google is currently unavailable." : publishFields.length === 0 ? "Everything is already in sync with Google." : null)

  const diffRows = profile.fields.map((f) => ({
    key: f.key,
    label: FIELD_LABELS[f.key],
    canonicalValue: f.canonicalValue,
    googleValue: f.googleValue,
    status: f.status as DiffStatus,
  }))

  return (
    <div className="flex flex-col gap-6">
      <p className="text-caption text-muted-foreground">
        Core identity fields live here and sync with NabaPresence. For categories,
        attributes, address details, and open status, use{" "}
        <Link href={`/locations/${locationId}/business-information`} className="underline">
          Business information
        </Link>
        .
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">NabaPresence vs Google</h2>
        <CanonicalDiff rows={diffRows} />
      </section>

      <ImportReviewPanel
        locationId={locationId}
        resourceType="profile"
        canonicalRevision={revision}
        editDisabledReason={editReason}
      />

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
        </div>
        {/* When the edit gate is set, publishReason === editReason (the `??`
            short-circuits) and the note is already shown once under "Edit
            details"; only a publish-specific reason is shown here. */}
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
    </div>
  )
}
