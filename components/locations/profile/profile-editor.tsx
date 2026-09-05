"use client"

import { useCallback, useMemo, useRef, useState } from "react"

import { EditorFooter } from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"
import { CapabilityBanner } from "@/components/editors/capability-banner"
import { industryCapability } from "@/lib/locations/industry-capability"
import { Spinner } from "@/components/ui/spinner"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import type { ChangeRow } from "@/components/editors/change-diff"
import { LocationTab } from "@/components/locations/location-tab"
import { AttributesSection } from "@/components/locations/profile/sections/attributes-section"
import { ContactSection } from "@/components/locations/profile/sections/contact-section"
import { IdentitySection } from "@/components/locations/profile/sections/identity-section"
import { IndustrySections } from "@/components/locations/profile/sections/industry-sections"
import { ApiClientError } from "@/lib/api/client"
import {
  fetchBusinessInformation,
  publishBusinessAttributes,
  publishBusinessInformation,
  type BusinessInformationState,
  type GoogleAttribute,
} from "@/lib/api/location-business-information"
import {
  fetchProfile,
  runProfileOperation,
  saveProfile,
  type ProfileFieldKey,
  type ProfileState,
} from "@/lib/api/location-profile"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { usePublishFlow, type PublishStep } from "@/lib/editors/use-publish-flow"
import {
  buildAttributesUpdate,
  buildLocationUpdate,
  draftFromLocation,
  fieldErrorsFromPayload,
  presentUnsupportedLeaves,
} from "@/lib/locations/business-information-draft"
import {
  profileFormSchema,
  toProfileValues,
  type ProfileFormValues,
} from "@/lib/locations/forms/profile"
import {
  attributesFromState,
  describeAttributeValue,
  locationDiffRows,
} from "@/lib/locations/google-values"
import { queryKeys } from "@/lib/queries/keys"
import {
  useProfileEditor,
  type ProfileEditorState,
} from "@/lib/queries/use-location-profile-editor"

const FIELD_LABELS: Record<ProfileFieldKey, string> = {
  name: "Business name",
  description: "Description",
  phone: "Phone",
  address: "Address",
  mapsUrl: "Google Maps link",
  reviewUrl: "Review link",
  website: "Website",
}
/** The fields NabaPresence holds a copy of and can push to Google. */
const EDITABLE: ProfileFieldKey[] = ["name", "description", "phone", "website"]

type FieldErrors = Partial<Record<keyof ProfileFormValues, string>>

// Server zod errors on the PUT body arrive under path ["values", <field>]; map
// them back to form fields (mirrors lib/api/auth-errors.ts fieldErrorsFrom,
// adapted for the nested `values` body).
function serverFieldErrors(error: unknown): FieldErrors {
  if (
    !(error instanceof ApiClientError) ||
    error.code !== "invalid_request" ||
    !Array.isArray(error.details)
  )
    return {}
  const fields: FieldErrors = {}
  for (const issue of error.details) {
    const path = (issue as { path?: unknown[] }).path
    const message = (issue as { message?: unknown }).message
    const key = Array.isArray(path) ? String(path[path.length - 1] ?? "") : ""
    if (
      (key === "name" ||
        key === "description" ||
        key === "phone" ||
        key === "website") &&
      typeof message === "string" &&
      !(key in fields)
    ) {
      fields[key as keyof ProfileFormValues] = message
    }
  }
  return fields
}

function canonicalValues(profile: ProfileState): ProfileFormValues {
  const byKey = new Map(profile.fields.map((field) => [field.key, field]))
  return {
    name: byKey.get("name")?.canonicalValue ?? "",
    description: byKey.get("description")?.canonicalValue ?? "",
    phone: byKey.get("phone")?.canonicalValue ?? "",
    website: byKey.get("website")?.canonicalValue ?? "",
  }
}

export function ProfileTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      loadingLabel="business profile"
      useResource={useProfileEditor}
      resource="businessInformation"
    >
      {({ data, caps, editReason, publishReason }) => (
        <ProfileEditor
          key={data.profile.canonicalResource.revision}
          locationId={locationId}
          state={data}
          // Editors stay disabled (without a reason) until the role is known,
          // so a member never sees a briefly-enabled field.
          disabled={!caps || editReason !== null}
          editReason={editReason}
          publishReason={editReason ?? publishReason}
        />
      )}
    </LocationTab>
  )
}

function ProfileEditor({
  locationId,
  state,
  disabled,
  editReason,
  publishReason,
}: {
  locationId: string
  state: ProfileEditorState
  disabled: boolean
  editReason: string | null
  publishReason: string | null
}) {
  const { profile, business } = state
  const revision = profile.canonicalResource.revision

  const initialValues = useMemo(() => canonicalValues(profile), [profile])
  const {
    draft: values,
    setDraft: setValues,
    isDirty: valuesDirty,
    discard: discardValues,
  } = useEditorDraft({
    initial: initialValues,
    revision,
    key: `location-profile-${locationId}`,
  })
  const [errors, setErrors] = useState<FieldErrors>({})

  const initialListing = useMemo(
    () => draftFromLocation(business?.location),
    [business?.location]
  )
  const {
    draft: listing,
    setDraft: setListing,
    isDirty: listingDirty,
    discard: discardListing,
  } = useEditorDraft({
    initial: initialListing,
    revision: business?.locationHash ?? null,
    key: `location-listing-${locationId}`,
  })

  const initialAttributes = useMemo(
    () =>
      business
        ? attributesFromState(business.attributes, business.attributeMetadata)
        : {},
    [business]
  )
  const {
    draft: attributes,
    setDraft: setAttributes,
    isDirty: attributesDirty,
    discard: discardAttributes,
  } = useEditorDraft<Record<string, GoogleAttribute>>({
    initial: initialAttributes,
    revision: business?.attributesHash ?? null,
    key: `location-attributes-${locationId}`,
  })

  const listingUpdate = useMemo(
    () => buildLocationUpdate(initialListing, listing),
    [initialListing, listing]
  )
  const listingIssues = useMemo(
    () => fieldErrorsFromPayload(listingUpdate.payload),
    [listingUpdate.payload]
  )
  const attributesUpdate = useMemo(
    () =>
      buildAttributesUpdate(
        business?.attributeMetadata ?? [],
        initialAttributes,
        attributes
      ),
    [business, initialAttributes, attributes]
  )

  // Fields NabaPresence can push whose copy already differs from Google's.
  const driftedEditable = profile.fields.filter(
    (field) => EDITABLE.includes(field.key) && field.status !== "in_sync"
  )
  const needsAck = driftedEditable.some(
    (field) => field.status === "google_dirty" || field.status === "conflict"
  )

  const rows = useMemo<ChangeRow[]>(() => {
    const out: ChangeRow[] = []
    for (const field of profile.fields) {
      if (!EDITABLE.includes(field.key)) continue
      const next = values[field.key as keyof ProfileFormValues] ?? ""
      const current = field.googleValue ?? ""
      if (next === current) continue
      out.push({
        key: `profile-${field.key}`,
        field: FIELD_LABELS[field.key],
        before: field.googleValue ?? "",
        after: next,
        state:
          field.status === "google_dirty" || field.status === "conflict"
            ? "conflict"
            : "changed",
      })
    }
    for (const row of locationDiffRows(
      listingUpdate.updateMask,
      initialListing,
      listing
    )) {
      out.push({
        key: `listing-${row.key}`,
        field: row.label,
        before: row.currentValue ?? "",
        after: row.nextValue ?? "",
      })
    }
    const metaByName = new Map(
      (business?.attributeMetadata ?? []).map((meta) => [meta.parent, meta])
    )
    for (const name of attributesUpdate.attributeMask) {
      const meta = metaByName.get(name)
      out.push({
        key: `attribute-${name}`,
        field: meta?.displayName ?? name,
        before: describeAttributeValue(meta, initialAttributes[name]) ?? "",
        after: describeAttributeValue(meta, attributes[name]) ?? "",
      })
    }
    return out
  }, [
    profile.fields,
    values,
    listingUpdate.updateMask,
    initialListing,
    listing,
    business,
    attributesUpdate.attributeMask,
    initialAttributes,
    attributes,
  ])

  const [reviewOpen, setReviewOpen] = useState(false)
  const saved = useRef<ProfileState | null>(null)
  // Publishing the name to Google moves Google's own copy of the listing, and
  // with it the hash the next two steps pin. Re-read it after that step so the
  // steps that follow are not rejected for a change this flow just made.
  const listingAfterProfile = useRef<BusinessInformationState | null>(null)

  /**
   * Up to four requests behind one button, in the order the data depends on:
   * the NabaPresence copy is saved first because the publish that follows
   * pins the revision it produced, and Google's own listing fields go last.
   */
  const buildSteps = useCallback(() => {
    const list: PublishStep[] = []
    if (valuesDirty) {
      list.push({
        key: "save",
        label: "Save the details in NabaPresence",
        run: async () => {
          const parsed = profileFormSchema.parse(values)
          try {
            await saveProfile(locationId, {
              expectedCanonicalRevision: revision,
              values: toProfileValues(parsed),
            })
          } catch (cause) {
            // A server validation error belongs on the field it names, not
            // only in the step's failure line.
            const fields = serverFieldErrors(cause)
            if (Object.keys(fields).length > 0) setErrors(fields)
            throw cause
          }
          saved.current = await fetchProfile(locationId)
        },
      })
    }
    list.push({
      key: "profile",
      label: "Publish name, description, phone and website",
      run: async () => {
        const fresh = saved.current ?? profile
        const fields = fresh.fields
          .filter(
            (field) => EDITABLE.includes(field.key) && field.status !== "in_sync"
          )
          .map((field) => field.key)
        listingAfterProfile.current = null
        // Nothing drifted: the NabaPresence copy already matches Google.
        if (fields.length === 0) return
        await runProfileOperation(locationId, {
          direction: "to_google",
          confirmation: "publish_nabapresence_profile_to_google",
          selectedFields: fields,
          expectedCanonicalRevision: fresh.canonicalResource.revision,
          expectedCanonicalHash: fresh.canonicalHash,
          expectedGoogleHash: fresh.googleHash,
          confirmOverwriteGoogleChanges: needsAck,
        })
        listingAfterProfile.current = await fetchBusinessInformation(locationId)
      },
    })
    if (business && listingUpdate.updateMask.length > 0) {
      list.push({
        key: "listing",
        label: "Publish categories, address and status",
        run: () =>
          publishBusinessInformation(locationId, {
            updateMask: listingUpdate.updateMask,
            payload: businessInformationPayloadSchema.parse(
              listingUpdate.payload
            ),
            expectedGoogleHash:
              listingAfterProfile.current?.locationHash ??
              business.locationHash,
          }),
      })
    }
    if (business && attributesUpdate.attributeMask.length > 0) {
      list.push({
        key: "attributes",
        label: "Publish attributes",
        run: () =>
          publishBusinessAttributes(locationId, {
            attributeMask: attributesUpdate.attributeMask,
            attributes: attributesUpdate.attributes,
            expectedGoogleHash:
              listingAfterProfile.current?.attributesHash ??
              business.attributesHash,
          }),
      })
    }
    return list
  }, [
    valuesDirty,
    values,
    locationId,
    revision,
    profile,
    needsAck,
    listingUpdate,
    attributesUpdate,
    business,
  ])

  const flow = usePublishFlow({
    steps: buildSteps,
    invalidate: [
      queryKeys.locationProfile(locationId),
      queryKeys.locationBusinessInformation(locationId),
    ],
    successToast: "Business profile published to Google",
    onSuccess: () => setReviewOpen(false),
  })

  function review() {
    const parsed = profileFormSchema.safeParse(values)
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === "string")
          next[key as keyof ProfileFormValues] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    flow.reset()
    setReviewOpen(true)
  }

  const isDirty = valuesDirty || listingDirty || attributesDirty
  // Until Google's half of the listing is in, `rows` can only hold the four
  // NabaPresence fields, so an empty `rows` does NOT mean the listing matches:
  // categories, address, open status and every attribute are simply unfetched.
  // Claiming "in sync" here is worse than saying nothing — the page asserts
  // everything is fine and then silently grows by seven controls.
  const googleReady = business !== null
  const settled = googleReady && rows.length === 0
  const blocked =
    publishReason ??
    (Object.keys(listingIssues).length > 0
      ? "Fix the highlighted fields before publishing."
      : // While Google's half is outstanding the Review button is already
        // disabled by having nothing to review, and the status line beside the
        // fields says why. A gate note here would be the same sentence twice.
        !googleReady
        ? null
        : rows.length === 0
          ? "Everything already matches Google."
          : null)

  const unsupported = business
    ? presentUnsupportedLeaves(business.location)
    : []
  const industry = industryCapability(business?.location)

  return (
    <EditorFrame
      title="Business profile"
      description="The name, categories, contact details and attributes customers see on Google."
      statusLabel={settled ? "In sync with Google" : undefined}
      tone="healthy"
      gateReason={editReason}
      footer={
        <EditorFooter
          status={
            settled ? "in_sync" : needsAck ? "conflict" : "edited"
          }
          isDirty={rows.length > 0}
          canDiscard={isDirty}
          onReview={review}
          onDiscard={() => {
            discardValues()
            discardListing()
            discardAttributes()
            setErrors({})
          }}
          disabledReason={blocked}
          hint={
            googleReady
              ? "Everything on this page matches Google."
              : "Nothing to publish yet."
          }
        />
      }
    >
      <IdentitySection
        locationId={locationId}
        values={values}
        setValues={setValues}
        draft={listing}
        setDraft={setListing}
        errors={errors}
        issues={listingIssues}
        disabled={disabled}
        googleReady={googleReady}
      />

      <ContactSection
        values={values}
        setValues={setValues}
        draft={listing}
        setDraft={setListing}
        errors={errors}
        issues={listingIssues}
        disabled={disabled}
        googleReady={googleReady}
      />

      {state.businessPending ? (
        // Named, not just "loading": the fields below are about to appear and
        // push the footer down the page, so the operator should know that is
        // coming rather than watch the page move under them.
        <p
          role="status"
          className="flex items-center gap-2 text-ui text-ink-muted"
        >
          <Spinner decorative size="sm" className="shrink-0" />
          Reading categories, address and attributes from Google…
        </p>
      ) : null}

      {state.businessError ? (
        <CapabilityBanner
          tone="info"
          title="We couldn't read this listing from Google"
          description="The name, description, phone and website above are what NabaPresence holds, and you can still edit them. Categories, address and attributes need Google, so they're hidden until it answers."
        />
      ) : null}

      {/* Lodging, calls and healthcare publish through their own Google APIs
          with their own hashes, so they keep their own controls rather than
          pretending to be part of the listing write above.

          Mounted only when Google says this listing can actually have that
          data: the group costs seven paced Google calls, and for an ordinary
          business every one of them fails and it renders nothing. */}
      {industry.any ? (
        <IndustrySections locationId={locationId} enabled={googleReady} />
      ) : null}

      <AttributesSection
        metadata={business?.attributeMetadata ?? []}
        draft={attributes}
        onChange={(next) =>
          setAttributes((prev) => ({ ...prev, [next.name]: next }))
        }
        disabled={disabled}
      />

      {unsupported.length > 0 ? (
        <section className="flex max-w-2xl flex-col gap-1 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
          <h3 className="text-title font-semibold text-ink">
            Other Google details
          </h3>
          <p className="text-ui text-ink-muted">
            Google holds more on this listing than NabaPresence can edit yet:{" "}
            {unsupported.map(({ label }) => label).join(", ")}. Change those in
            Google directly.
          </p>
        </section>
      ) : null}

      <ReviewChangesSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        rows={rows}
        locationName={profile.location.name}
        onPublish={() => void flow.publish()}
        publishing={flow.isPublishing}
        results={flow.results}
        error={flow.error}
      />
    </EditorFrame>
  )
}
