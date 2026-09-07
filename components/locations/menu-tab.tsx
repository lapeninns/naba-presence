"use client"

import { UtensilsCrossed } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"

import { EditorFooter } from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { LocationTab } from "@/components/locations/location-tab"
import { MenuEditor, type MenuEditorValidation } from "@/components/locations/menu-editor"
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { fetchFoodMenus, publishFoodMenus, saveFoodMenus, type FoodMenusState } from "@/lib/api/location-menu"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { usePublishFlow } from "@/lib/editors/use-publish-flow"
import { countFoodMenus } from "@/lib/locations/forms/food-menus"
import { hydrateMenus, menuIssues, menuStructureSummary } from "@/lib/locations/forms/menu-editor"
import type { TabGateReasons } from "@/lib/locations/gating"
import { menuChangeRows } from "@/lib/locations/menu-diff"
import { queryKeys } from "@/lib/queries/keys"
import { useFoodMenus } from "@/lib/queries/use-location-menu"

export function MenuTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab locationId={locationId} loadingLabel="food menu" useResource={useFoodMenus} resource="menu">
      {({ data: state, disabled, editReason, publishReason }) => state.eligible ? (
        <MenuForm key={state.canonicalResource.revision} locationId={locationId} state={state} disabled={disabled} editReason={editReason} publishReason={publishReason} />
      ) : (
        <Empty icon={<UtensilsCrossed aria-hidden />} title="This location can’t have a food menu" description="Google reports that this location type is not eligible for a food menu, so there’s nothing to manage here." />
      )}
    </LocationTab>
  )
}

function MenuForm({ locationId, state, disabled, editReason, publishReason: gateReason }: TabGateReasons & { locationId: string; state: FoodMenusState }) {
  const { draft, setDraft, isDirty, discard } = useEditorDraft({ initial: state.canonicalMenus, revision: state.canonicalResource.revision, key: `location-menu-${locationId}` })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [editorVersion, setEditorVersion] = useState(0)
  const [validation, setValidation] = useState<MenuEditorValidation>(() => ({ valid: menuIssues(hydrateMenus(state.canonicalMenus)).length === 0, hasUncommittedInput: false }))
  const keepEditingRef = useRef<HTMLButtonElement>(null)

  const rows = useMemo(() => {
    const itemRows = menuChangeRows({ draft, google: state.googleMenus })
    const before = menuStructureSummary(state.googleMenus)
    const after = menuStructureSummary(draft)
    // The item matcher alone cannot describe menu/section renames, ordering,
    // empty sections, or the text of description-only edits. Include them in
    // the existing confirmation sheet; do not add a second publishing path.
    return before === after ? itemRows : [{ key: "menu-structure-and-descriptions", field: "Menu structure and descriptions", before, after }, ...itemRows]
  }, [draft, state.googleMenus])

  const saved = useRef<FoodMenusState | null>(null)
  const buildSteps = useCallback(() => [
    {
      key: "save",
      label: "Save the menu in NabaPresence",
      run: async () => {
        await saveFoodMenus(locationId, { expectedCanonicalRevision: state.canonicalResource.revision, menus: draft })
        saved.current = await fetchFoodMenus(locationId)
      },
    },
    {
      key: "publish",
      label: "Replace the food menu on Google",
      run: async () => {
        const fresh = saved.current
        if (!fresh) throw new Error("The menu was not saved.")
        await publishFoodMenus(locationId, { expectedCanonicalRevision: fresh.canonicalResource.revision, expectedCanonicalHash: fresh.canonicalHash, expectedGoogleHash: fresh.googleHash })
      },
    },
  ], [locationId, draft, state.canonicalResource.revision])

  const flow = usePublishFlow({ steps: buildSteps, invalidate: [queryKeys.locationMenu(locationId)], successToast: "Menu published to Google", onSuccess: () => setReviewOpen(false) })
  const localChanges = isDirty || validation.hasUncommittedInput
  const changesToReview = localChanges || state.status !== "in_sync"
  const publishReason = editReason ?? gateReason ?? (!validation.valid ? "Fix the highlighted names and prices before reviewing changes." : flow.isPublishing ? "Publishing is in progress." : null)
  const draftCounts = countFoodMenus(draft)

  function discardAll() {
    if (flow.isPublishing || disabled) return
    discard()
    // Remount even when invalid raw text was the ONLY edit: the canonical
    // array may be unchanged, but that must not leave an invalid field behind.
    setEditorVersion((version) => version + 1)
    setValidation({ valid: menuIssues(hydrateMenus(state.canonicalMenus)).length === 0, hasUncommittedInput: false })
    setDiscardOpen(false)
  }

  return (
    <EditorFrame title="Food menu" description={`Manage ${draftCounts.menus} ${draftCounts.menus === 1 ? "menu" : "menus"}, ${draftCounts.sections} sections and ${draftCounts.items} items. Publishing replaces the complete food menu on Google.`}
      statusLabel={state.status === "in_sync" && !localChanges ? "In sync with Google" : undefined} tone="healthy" gateReason={editReason}
      footer={<EditorFooter status={localChanges ? "edited" : state.status === "in_sync" ? "in_sync" : "unpublished"} isDirty={changesToReview} canDiscard={localChanges && !flow.isPublishing} disabledReason={publishReason}
        onReview={() => {
          if (disabled || publishReason || !validation.valid || !changesToReview) return
          saved.current = null
          flow.reset()
          setReviewOpen(true)
        }} onDiscard={() => { if (localChanges && !flow.isPublishing) setDiscardOpen(true) }}
        hint={state.status === "in_sync" ? "All menus match Google." : "Google holds a different menu. Review every change before publishing."} />}
    >
      <MenuEditor key={editorVersion} menus={draft} onChange={setDraft} disabled={disabled || flow.isPublishing || reviewOpen} onValidationChange={setValidation} draftKey={`location-menu-inputs-${locationId}`} />
      <ReviewChangesSheet open={reviewOpen} onOpenChange={(open) => { if (!flow.isPublishing) setReviewOpen(open) }} rows={rows} locationName={state.location.name}
        onPublish={() => { if (!disabled && !publishReason && validation.valid && changesToReview) void flow.publish() }} publishing={flow.isPublishing} results={flow.results} error={flow.error} />
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent initialFocus={keepEditingRef}>
          <AlertDialogTitle>Discard all menu edits?</AlertDialogTitle>
          <AlertDialogDescription>This resets every menu to the last saved version, including unfinished prices. It does not change Google. Use Undo removal instead to restore only the last removed entry.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button ref={keepEditingRef} type="button" variant="secondary" />}>Keep editing</AlertDialogClose>
            <Button type="button" variant="destructive" disabled={flow.isPublishing || disabled} onClick={discardAll}>Discard all edits</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EditorFrame>
  )
}
