"use client"

import { UtensilsCrossed } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"

import { EditorFooter } from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { LocationTab } from "@/components/locations/location-tab"
import { MenuEditor } from "@/components/locations/menu-editor"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Empty } from "@/components/ui/empty"
import {
  fetchFoodMenus,
  publishFoodMenus,
  saveFoodMenus,
  type FoodMenusState,
} from "@/lib/api/location-menu"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { usePublishFlow } from "@/lib/editors/use-publish-flow"
import { countFoodMenus } from "@/lib/locations/forms/food-menus"
import type { TabGateReasons } from "@/lib/locations/gating"
import { menuChangeRows } from "@/lib/locations/menu-diff"
import { queryKeys } from "@/lib/queries/keys"
import { useFoodMenus } from "@/lib/queries/use-location-menu"

export function MenuTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      loadingLabel="food menu"
      useResource={useFoodMenus}
      resource="menu"
    >
      {({ data: state, disabled, editReason, publishReason }) =>
        state.eligible ? (
          <MenuForm
            // Remount on an external revision change so form-level error, dialog and
            // mutation state reset with the draft, as the pre-shell tab did.
            key={state.canonicalResource.revision}
            locationId={locationId}
            state={state}
            disabled={disabled}
            editReason={editReason}
            publishReason={publishReason}
          />
        ) : (
          <Empty
            icon={<UtensilsCrossed aria-hidden />}
            title="This location can’t have a food menu"
            description="Google reports that this location type is not eligible for a food menu, so there’s nothing to manage here."
          />
        )
      }
    </LocationTab>
  )
}

function MenuForm({
  locationId,
  state,
  disabled,
  editReason,
  publishReason: gateReason,
}: TabGateReasons & { locationId: string; state: FoodMenusState }) {
  const { draft, setDraft, isDirty, discard } = useEditorDraft({
    initial: state.canonicalMenus,
    revision: state.canonicalResource.revision,
    key: `location-menu-${locationId}`,
  })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const rows = useMemo(
    () => menuChangeRows({ draft, google: state.googleMenus }),
    [draft, state.googleMenus]
  )

  const saved = useRef<FoodMenusState | null>(null)
  const buildSteps = useCallback(
    () => [
      {
        key: "save",
        label: "Save the menu in NabaPresence",
        run: async () => {
          await saveFoodMenus(locationId, {
            expectedCanonicalRevision: state.canonicalResource.revision,
            menus: draft,
          })
          saved.current = await fetchFoodMenus(locationId)
        },
      },
      {
        key: "publish",
        label: "Replace the food menu on Google",
        run: async () => {
          const fresh = saved.current
          if (!fresh) throw new Error("The menu was not saved.")
          await publishFoodMenus(locationId, {
            expectedCanonicalRevision: fresh.canonicalResource.revision,
            expectedCanonicalHash: fresh.canonicalHash,
            expectedGoogleHash: fresh.googleHash,
          })
        },
      },
    ],
    [locationId, draft, state.canonicalResource.revision]
  )

  const flow = usePublishFlow({
    steps: buildSteps,
    invalidate: [queryKeys.locationMenu(locationId)],
    successToast: "Menu published to Google",
    onSuccess: () => {
      setReviewOpen(false)
      setServerError(null)
    },
  })

  const publishReason = editReason ?? gateReason
  const draftCounts = countFoodMenus(draft as Array<Record<string, unknown>>)

  return (
    <EditorFrame
      title="Food menu"
      description={`Publishing replaces the whole food menu on Google. ${draftCounts.sections} sections, ${draftCounts.items} items.`}
      statusLabel={
        state.status === "in_sync" && !isDirty ? "In sync with Google" : undefined
      }
      tone="healthy"
      gateReason={editReason}
      footer={
        <EditorFooter
          status={
            isDirty
              ? "edited"
              : state.status === "in_sync"
                ? "in_sync"
                : "unpublished"
          }
          isDirty={isDirty}
          onReview={() => {
            setServerError(null)
            flow.reset()
            setReviewOpen(true)
          }}
          onDiscard={discard}
          disabledReason={publishReason}
          hint={
            state.status === "in_sync"
              ? "This menu matches Google."
              : "Google holds a different menu. Review to see what differs."
          }
        />
      }
    >
      <MenuEditor menus={draft} onChange={setDraft} disabled={disabled} />

      {serverError ? (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <ReviewChangesSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        rows={rows}
        locationName={state.location.name}
        onPublish={() => void flow.publish()}
        publishing={flow.isPublishing}
        results={flow.results}
        error={flow.error}
      />
    </EditorFrame>
  )
}
