"use client"

import { useState } from "react"

import { ImportReviewPanel } from "@/components/locations/import-review-panel"
import { LocationTab } from "@/components/locations/location-tab"
import { MenuEditor } from "@/components/locations/menu-editor"
import { MenuPublishPreview } from "@/components/locations/menu-publish-preview"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { SaveBar } from "@/components/locations/save-bar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Empty } from "@/components/ui/empty"
import {
  publishFoodMenus,
  saveFoodMenus,
  type FoodMenusState,
} from "@/lib/api/location-menu"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { countFoodMenus } from "@/lib/locations/forms/food-menus"
import type { TabGateReasons } from "@/lib/locations/gating"
import { useResetOnRevision } from "@/lib/locations/use-reset-on-revision"
import { queryKeys } from "@/lib/queries/keys"
import { useFoodMenus } from "@/lib/queries/use-location-menu"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

export function MenuTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
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
  const [draft, setDraft] = useResetOnRevision(
    state.canonicalMenus,
    state.canonicalResource.revision
  )
  const [publishOpen, setPublishOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(state.canonicalMenus)
  useDirtyGuard({
    key: `location-menu-${locationId}`,
    isDirty,
    snapshot: () => JSON.stringify(draft),
  })

  // Nested per-field mapping is impractical for the freeform menu JSON, so
  // server errors surface in the form-level Alert (plus the hook's toast).
  const save = useResourceMutation({
    mutationFn: () =>
      saveFoodMenus(locationId, {
        expectedCanonicalRevision: state.canonicalResource.revision,
        menus: draft,
      }),
    invalidate: [queryKeys.locationMenu(locationId)],
    successToast: "Menu saved",
    onSuccess: () => setServerError(null),
    onError: (_error, message) => setServerError(message),
  })

  const publish = useResourceMutation({
    mutationFn: () =>
      publishFoodMenus(locationId, {
        expectedCanonicalRevision: state.canonicalResource.revision,
        expectedCanonicalHash: state.canonicalHash,
        expectedGoogleHash: state.googleHash,
      }),
    invalidate: [queryKeys.locationMenu(locationId)],
    successToast: "Menu published to Google",
    onSuccess: () => {
      setPublishOpen(false)
      setServerError(null)
    },
    onError: (_error, message) => setServerError(message),
  })

  const publishReason =
    gateReason ??
    (state.status === "in_sync"
      ? "Menu already matches Google."
      : isDirty
        ? "Save your changes before publishing."
        : null)
  const draftCounts = countFoodMenus(draft as Array<Record<string, unknown>>)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={state.status === "in_sync" ? "secondary" : "warning"}>
          {state.status === "in_sync"
            ? "In sync with Google"
            : "You have unpublished changes"}
        </Badge>
        <span className="text-caption text-muted-foreground">
          {draftCounts.sections} sections · {draftCounts.items} items
        </span>
      </div>

      <ImportReviewPanel
        locationId={locationId}
        resourceType="food_menus"
        canonicalRevision={state.canonicalResource.revision}
        editDisabledReason={editReason}
      />

      <MenuEditor menus={draft} onChange={setDraft} disabled={disabled} />

      {serverError ? (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <SaveBar
        onSave={() => save.mutate()}
        onPublish={() => setPublishOpen(true)}
        isDirty={isDirty}
        saving={save.isPending}
        publishing={publish.isPending}
        editReason={editReason}
        publishReason={publishReason}
      />

      <OverwriteConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Replace the Google food menu?"
        description="Publishing replaces your entire Google food menu with the menu shown here."
        confirmLabel="Publish"
        requireAcknowledgement
        acknowledgementLabel="I understand this replaces the whole food menu on Google."
        pending={publish.isPending}
        onConfirm={() => publish.mutate()}
      >
        <MenuPublishPreview
          canonicalMenus={state.canonicalMenus}
          googleMenus={state.googleMenus}
        />
      </OverwriteConfirmDialog>
    </div>
  )
}
