"use client"

import { useCallback, useMemo, useRef, useState } from "react"

import { DiscardDialog } from "@/components/editors/discard-dialog"
import { DraftNotices } from "@/components/editors/draft-notices"
import { EditorFooter } from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"
import { CapabilityBanner } from "@/components/editors/capability-banner"
import { industryCapability } from "@/lib/locations/industry-capability"
import { Spinner } from "@/components/ui/spinner"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import type { ChangeRow } from "@/components/editors/change-diff"
import { LocationTab } from "@/components/locations/location-tab"
import { AttributesSection } from "@/components/locations/profile/sections/attributes-section"
import {
  AddressSection,
  ContactSection,
  DescriptionSection,
  OpeningSection,
} from "@/components/locations/profile/sections/contact-section"
import {
  CategoriesSection,
  IdentitySection,
  PROFILE_FIELD_IDS,
} from "@/components/locations/profile/sections/identity-section"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ValidationSummary } from "@/components/ui/validation-summary"
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
import { editorGate } from "@/lib/editors/gate"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import {
  NOTHING_TO_SEND,
  usePublishFlow,
  type PublishStep,
} from "@/lib/editors/use-publish-flow"
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
import type { LocationCapabilities } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
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

/** The schema's messages are generic; say what to do instead. */
const FIELD_MESSAGES: Partial<Record<keyof ProfileFormValues, string>> = {
  name: "Keep the name under 255 characters.",
  description: "Google allows 750 characters. Shorten the description.",
  phone: "Keep the phone number under 50 characters.",
  website: "Enter a full web address starting with https://",
}

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
          // No remount on a revision change: each draft follows its own
          // revision, so saving the name here keeps unpublished category,
          // address and attribute edits, and a colleague's save mid-edit
          // asks whose to keep instead of wiping the form.
          locationId={locationId}
          state={data}
          caps={caps}
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
  caps,
  disabled,
  editReason,
  publishReason,
}: {
  locationId: string
  state: ProfileEditorState
  caps: LocationCapabilities | undefined
  disabled: boolean
  editReason: string | null
  publishReason: string | null
}) {
  const { profile, business } = state
  const revision = profile.canonicalResource.revision

  const initialValues = useMemo(() => canonicalValues(profile), [profile])
  const valuesDraft = useEditorDraft({
    initial: initialValues,
    revision,
    key: `location-profile-${locationId}`,
  })
  const {
    draft: values,
    setDraft: setValues,
    isDirty: valuesDirty,
    discard: discardValues,
  } = valuesDraft
  const [errors, setErrors] = useState<FieldErrors>({})

  const initialListing = useMemo(
    () => draftFromLocation(business?.location),
    [business?.location]
  )
  const listingDraft = useEditorDraft({
    initial: initialListing,
    revision: business?.locationHash ?? null,
    key: `location-listing-${locationId}`,
  })
  const {
    draft: listing,
    setDraft: setListing,
    isDirty: listingDirty,
    discard: discardListing,
  } = listingDraft

  const initialAttributes = useMemo(
    () =>
      business
        ? attributesFromState(business.attributes, business.attributeMetadata)
        : {},
    [business]
  )
  const attributesDraft = useEditorDraft<Record<string, GoogleAttribute>>({
    initial: initialAttributes,
    revision: business?.attributesHash ?? null,
    key: `location-attributes-${locationId}`,
  })
  const {
    draft: attributes,
    setDraft: setAttributes,
    isDirty: attributesDirty,
    discard: discardAttributes,
  } = attributesDraft

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
        kind: "local",
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
            (field) =>
              EDITABLE.includes(field.key) && field.status !== "in_sync"
          )
          .map((field) => field.key)
        listingAfterProfile.current = null
        // Nothing drifted: the NabaPresence copy already matches Google.
        if (fields.length === 0) return NOTHING_TO_SEND
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

  const [discardOpen, setDiscardOpen] = useState(false)
  // Validation shows after the first save or review attempt, then follows
  // every edit so a fixed field clears its message straight away.
  const [attempts, setAttempts] = useState(0)

  // "Save here" keeps NabaPresence's copy of the name, description, phone
  // and website. The other sections have no copy here, so their edits stay
  // in the form (the profile no longer remounts on save) until published.
  const save = useResourceMutation({
    mutationFn: () => {
      valuesDraft.expectSave()
      return saveProfile(locationId, {
        expectedCanonicalRevision: revision,
        values: toProfileValues(profileFormSchema.parse(values)),
      })
    },
    invalidate: [queryKeys.locationProfile(locationId)],
    successToast: "Saved here. Not on Google until you publish.",
    onError: (cause) => {
      const fields = serverFieldErrors(cause)
      if (Object.keys(fields).length > 0) setErrors(fields)
    },
  })

  /** Every problem in the draft, in page order, each tied to a field. */
  const issues = useMemo(() => {
    const out: { fieldId: string; message: string }[] = []
    const parsed = profileFormSchema.safeParse(values)
    const clientErrors: FieldErrors = {}
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === "string" && !(key in clientErrors))
          clientErrors[key as keyof ProfileFormValues] =
            FIELD_MESSAGES[key as keyof ProfileFormValues] ?? issue.message
      }
    }
    for (const key of ["name", "phone", "website", "description"] as const) {
      const message = clientErrors[key]
      if (message)
        out.push({
          fieldId: PROFILE_FIELD_IDS[key],
          message: `${FIELD_LABELS[key]}: ${message}`,
        })
    }
    if (listingIssues.addressLines)
      out.push({
        fieldId: PROFILE_FIELD_IDS.address,
        message: `Address: ${listingIssues.addressLines}`,
      })
    return { list: out, clientErrors }
  }, [values, listingIssues])

  function check() {
    setAttempts((count) => count + 1)
    setErrors(issues.clientErrors)
    return issues.list.length === 0
  }

  /** Only the four saved-here fields decide whether "Save here" can run. */
  function checkValues() {
    setAttempts((count) => count + 1)
    setErrors(issues.clientErrors)
    return Object.keys(issues.clientErrors).length === 0
  }

  function review() {
    if (!check()) return
    flow.reset()
    setReviewOpen(true)
  }

  const isDirty = valuesDirty || listingDirty || attributesDirty
  // Until Google's half of the listing is in, `rows` can only hold the four
  // NabaPresence fields, so an empty `rows` does NOT mean the listing matches:
  // categories, address, open status and every attribute are simply unfetched.
  // Claiming "in sync" here is worse than saying nothing.
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
  const gate = editorGate({
    caps,
    resource: "businessInformation",
    editReason,
    publishReason: editReason ? null : publishReason,
    noun: "this profile",
    savesHere: true,
  })

  // Per-field "Changed" marks: what differs from Google right now.
  const googleOf = (key: ProfileFieldKey) =>
    profile.fields.find((field) => field.key === key)?.googleValue ?? ""
  const differs = (a: unknown, b: unknown) =>
    JSON.stringify(a) !== JSON.stringify(b)
  const changed = {
    name: values.name !== googleOf("name"),
    description: values.description !== googleOf("description"),
    phone: values.phone !== googleOf("phone"),
    website: values.website !== googleOf("website"),
    storeCode: googleReady && listing.storeCode !== initialListing.storeCode,
    labels: googleReady && differs(listing.labels, initialListing.labels),
    primary:
      googleReady &&
      differs(
        listing.primaryCategory?.name,
        initialListing.primaryCategory?.name
      ),
    additional:
      googleReady &&
      differs(
        listing.additionalCategories.map((c) => c.name),
        initialListing.additionalCategories.map((c) => c.name)
      ),
    lines:
      googleReady && differs(listing.addressLines, initialListing.addressLines),
    locality: googleReady && listing.locality !== initialListing.locality,
    postalCode: googleReady && listing.postalCode !== initialListing.postalCode,
    opening: googleReady && listing.openStatus !== initialListing.openStatus,
    attributes: attributesUpdate.attributeMask.length > 0,
  }
  const sections = [
    {
      id: "section-identity",
      label: "Identity",
      changed: changed.name || changed.storeCode || changed.labels,
      show: true,
    },
    {
      id: "section-categories",
      label: "Categories",
      changed: changed.primary || changed.additional,
      show: googleReady,
    },
    {
      id: "section-contact",
      label: "Contact",
      changed: changed.phone || changed.website,
      show: true,
    },
    {
      id: "section-address",
      label: "Address",
      changed: changed.lines || changed.locality || changed.postalCode,
      show: googleReady,
    },
    {
      id: "section-description",
      label: "Description",
      changed: changed.description,
      show: true,
    },
    {
      id: "section-opening",
      label: "Opening state",
      changed: changed.opening,
      show: googleReady,
    },
    {
      id: "section-attributes",
      label: "Attributes",
      changed: changed.attributes,
      show: (business?.attributeMetadata.length ?? 0) > 0,
    },
  ].filter((section) => section.show)

  const saveReason =
    editReason ??
    (!valuesDirty && (listingDirty || attributesDirty)
      ? "Categories, address, opening state and attributes go straight to Google when you publish; only the name, description, phone and website are saved here."
      : null)

  return (
    <EditorFrame
      title="Business profile"
      titleHidden
      // The frame is a container so the footer can follow the same 900px
      // switch as the section index below: from there the dark bar starts
      // at the form column (12.5rem index + gap-6), as in the reference.
      className="@container/profile-frame"
      footer={
        <EditorFooter
          className="@[900px]/profile-frame:ml-[calc(12.5rem+1.5rem)]"
          status={settled ? "in_sync" : needsAck ? "conflict" : "edited"}
          isDirty={rows.length > 0}
          canDiscard={isDirty}
          changeCount={rows.length}
          onReview={review}
          onDiscard={() => setDiscardOpen(true)}
          onSave={() => {
            if (checkValues()) save.mutate()
          }}
          saving={save.isPending}
          saveDisabledReason={saveReason}
          disabledReason={blocked}
          // A role that can't edit gets the one view-only bar, not a row
          // of disabled buttons.
          readOnlyReason={editReason}
          hint={
            googleReady
              ? "Everything on this page matches Google."
              : "Nothing to publish yet."
          }
        />
      }
    >
      {gate ? (
        <CapabilityBanner
          tone={gate.tone}
          title={gate.title}
          description={gate.description}
          code={gate.code}
        />
      ) : null}

      <DraftNotices
        drafts={[valuesDraft, listingDraft, attributesDraft]}
        noun="this profile"
      />

      {!gate && needsAck ? (
        <CapabilityBanner
          tone="warning"
          title="Google changed this profile since NabaPresence last saved it"
          description="Review changes shows both versions of each field; publishing replaces Google’s."
        />
      ) : null}

      <div className="@container/profile">
        <div className="grid grid-cols-1 items-start gap-6 @[900px]/profile:grid-cols-[12.5rem_minmax(0,1fr)]">
          <SectionIndex sections={sections} />

          <div className="@container/profile-body flex min-w-0 flex-col gap-5">
            <SectionJump sections={sections} />

            <ValidationSummary
              errors={attempts > 0 ? issues.list : []}
              focusKey={attempts}
            />

            <IdentitySection
              values={values}
              setValues={setValues}
              draft={listing}
              setDraft={setListing}
              errors={errors}
              disabled={disabled}
              googleReady={googleReady}
              changed={changed}
            />

            {googleReady ? (
              <CategoriesSection
                locationId={locationId}
                draft={listing}
                setDraft={setListing}
                disabled={disabled}
                changed={changed}
              />
            ) : null}

            <ContactSection
              values={values}
              setValues={setValues}
              errors={errors}
              disabled={disabled}
              changed={changed}
            />

            {googleReady ? (
              <AddressSection
                draft={listing}
                setDraft={setListing}
                issues={listingIssues}
                disabled={disabled}
                changed={changed}
              />
            ) : null}

            <DescriptionSection
              values={values}
              setValues={setValues}
              errors={errors}
              disabled={disabled}
              changed={changed.description}
            />

            {state.businessPending ? (
              // Named, not just "loading": the sections below are about to
              // appear and push the footer down the page, so the operator
              // should know that is coming rather than watch the page move.
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

            {googleReady ? (
              <OpeningSection
                locationId={locationId}
                draft={listing}
                setDraft={setListing}
                issues={listingIssues}
                disabled={disabled}
                changed={changed.opening}
              />
            ) : null}

            <AttributesSection
              metadata={business?.attributeMetadata ?? []}
              draft={attributes}
              initial={initialAttributes}
              onChange={(next) =>
                setAttributes((prev) => ({ ...prev, [next.name]: next }))
              }
              onClear={(name) =>
                setAttributes((prev) => {
                  const next = { ...prev }
                  delete next[name]
                  return next
                })
              }
              disabled={disabled}
            />

            {/* Lodging, calls and healthcare publish through their own Google
                APIs with their own hashes, so they keep their own controls
                (Business calls publishes on its own) rather than pretending to
                be part of the listing write above. Mounted only when Google
                says this listing can have that data. */}
            {industry.any ? (
              <IndustrySections locationId={locationId} enabled={googleReady} />
            ) : null}

            {unsupported.length > 0 ? (
              <section className="flex flex-col gap-1 rounded-(--np-radius-card) border border-line bg-surface-alt px-4 py-3">
                <h3 className="text-ui font-semibold text-ink">
                  Other Google details
                </h3>
                <p className="text-ui text-ink-muted">
                  Google holds more on this listing than NabaPresence can edit
                  yet: {unsupported.map(({ label }) => label).join(", ")}.
                  Change those in Google directly.
                </p>
              </section>
            ) : null}
          </div>
        </div>
      </div>

      <DiscardDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={() => {
          discardValues()
          discardListing()
          discardAttributes()
          setErrors({})
          setAttempts(0)
        }}
      />

      <ReviewChangesSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        rows={rows}
        locationName={profile.location.name}
        onPublish={() => {
          valuesDraft.expectSave()
          listingDraft.expectSave()
          attributesDraft.expectSave()
          void flow.publish()
        }}
        publishing={flow.isPublishing}
        results={flow.results}
        error={flow.error}
        publishDisabledReason={publishReason}
      />
    </EditorFrame>
  )
}

type IndexSection = { id: string; label: string; changed: boolean }

function jumpTo(id: string) {
  const section = document.getElementById(id)
  if (!section) return
  section.scrollIntoView({ block: "start" })
  document.getElementById(`${id}-heading`)?.focus({ preventScroll: true })
}

/** The sticky section index beside the form on a wide container. */
function SectionIndex({ sections }: { sections: IndexSection[] }) {
  const [current, setCurrent] = useState<string | null>(null)
  return (
    <nav
      aria-label="Profile sections"
      className="sticky top-0 hidden @[900px]/profile:block"
    >
      <ol className="flex flex-col gap-0.5">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={current === section.id ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault()
                setCurrent(section.id)
                jumpTo(section.id)
              }}
              className="relative flex min-h-8 items-center gap-2 rounded-(--np-radius-control) px-2.5 text-ui text-ink-secondary no-underline focus-halo hover:bg-fill hover:text-ink aria-[current=true]:bg-accent-tint aria-[current=true]:font-semibold aria-[current=true]:text-accent-ink"
            >
              {section.label}
              {section.changed ? (
                <>
                  <span
                    aria-hidden
                    className="ml-auto size-1.5 rounded-full bg-info-solid"
                  />
                  <span className="sr-only"> (changed)</span>
                </>
              ) : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** "Jump to section" on a narrow container, where the index would crowd the form. */
function SectionJump({ sections }: { sections: IndexSection[] }) {
  // Jump once the list has closed: closing hands focus back to the trigger,
  // which scrolled the page straight back up to this select and left focus
  // on it instead of on the section's heading.
  const pending = useRef<string | null>(null)
  return (
    <div className="@[900px]/profile:hidden">
      <Field>
        <FieldLabel>Jump to section</FieldLabel>
        <Select
          value={null}
          onValueChange={(value: string | null) => {
            pending.current = value
          }}
          onOpenChangeComplete={(open) => {
            if (open || !pending.current) return
            const id = pending.current
            pending.current = null
            jumpTo(id)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.label}
                {section.changed ? " · changed" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}
