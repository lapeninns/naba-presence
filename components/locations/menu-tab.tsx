"use client"

import { DownloadIcon, Plus, UtensilsCrossed } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"

import { DiscardDialog } from "@/components/editors/discard-dialog"
import { DraftNotices } from "@/components/editors/draft-notices"
import { EditorFooter } from "@/components/editors/editor-footer"
import { EditorFrame } from "@/components/editors/editor-frame"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { LocationTab } from "@/components/locations/location-tab"
import {
  MenuEditor,
  stripDraftKeys,
  validateMenu,
  type MenuProblem,
} from "@/components/locations/menu-editor"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { ValidationSummary } from "@/components/ui/validation-summary"
import {
  fetchFoodMenus,
  publishFoodMenus,
  saveFoodMenus,
  type FoodMenusState,
} from "@/lib/api/location-menu"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { usePublishFlow } from "@/lib/editors/use-publish-flow"
import { formatNumber } from "@/lib/format"
import { countFoodMenus } from "@/lib/locations/forms/food-menus"
import type { TabGateReasons } from "@/lib/locations/gating"
import { menuChangeRows } from "@/lib/locations/menu-diff"
import { queryKeys } from "@/lib/queries/keys"
import { useFoodMenus } from "@/lib/queries/use-location-menu"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

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
            // No remount on a revision change: useEditorDraft follows the
            // new revision itself, and keeps unsaved edits (asking whose to
            // keep) when a colleague's save lands mid-edit.
            locationId={locationId}
            state={state}
            disabled={disabled}
            editReason={editReason}
            publishReason={publishReason}
          />
        ) : (
          <div className="rounded-lg border border-line bg-surface">
            <Empty
              icon={<UtensilsCrossed aria-hidden />}
              titleAs="h2"
              title="This location can’t have a food menu"
              description="Google reports that this location type is not eligible for a food menu, so there’s nothing to manage here."
            />
          </div>
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
  const editor = useEditorDraft({
    initial: state.canonicalMenus,
    revision: state.canonicalResource.revision,
    key: `location-menu-${locationId}`,
  })
  const { draft, setDraft, isDirty, discard, expectSave } = editor
  const [reviewOpen, setReviewOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // Problems show once a review has been attempted, then follow the edits
  // live so each one clears as it is fixed.
  const [checked, setChecked] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // The menu as Google would receive it: the editor's typing state removed.
  const clean = useMemo(() => stripDraftKeys(draft), [draft])
  const problems: MenuProblem[] = useMemo(
    () => (checked ? validateMenu(draft) : []),
    [checked, draft]
  )

  const rows = useMemo(
    () => menuChangeRows({ draft: clean, google: state.googleMenus }),
    [clean, state.googleMenus]
  )

  const saved = useRef<FoodMenusState | null>(null)
  const buildSteps = useCallback(
    () => [
      {
        key: "save",
        label: "Save the menu in NabaPresence",
        run: async () => {
          expectSave()
          await saveFoodMenus(locationId, {
            expectedCanonicalRevision: state.canonicalResource.revision,
            menus: clean,
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
    [locationId, clean, state.canonicalResource.revision, expectSave]
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

  // "Save here": NabaPresence's copy only, as in Hours and Profile. The
  // area note ("Saved here first") promised this; the footer never offered it.
  const save = useResourceMutation({
    mutationFn: () => {
      expectSave()
      return saveFoodMenus(locationId, {
        expectedCanonicalRevision: state.canonicalResource.revision,
        menus: clean,
      })
    },
    invalidate: [queryKeys.locationMenu(locationId)],
    successToast: "Saved here. Not on Google until you publish.",
    onSuccess: () => setServerError(null),
    onError: (_error, message) => setServerError(message),
  })

  function saveHere() {
    const found = validateMenu(draft)
    setChecked(true)
    setAttempt((count) => count + 1)
    if (found.length > 0) return
    save.mutate()
  }

  const publishReason = editReason ?? gateReason
  const draftCounts = countFoodMenus(clean as Array<Record<string, unknown>>)
  const googleHasMenu = state.googleCounts.sections > 0
  const noMenu = draftCounts.sections === 0

  const changeCount = rows.length
  const statusLabel =
    noMenu && !isDirty
      ? googleHasMenu
        ? "Menu only on Google"
        : "No menu"
      : changeCount > 0
      ? `${formatNumber(changeCount)} ${changeCount === 1 ? "change" : "changes"} not on Google`
      : state.status === "in_sync" && !isDirty
        ? noMenu
          ? "No menu"
          : "In sync with Google"
        : undefined

  function review() {
    const found = validateMenu(draft)
    setChecked(true)
    setAttempt((count) => count + 1)
    if (found.length > 0) return
    setServerError(null)
    flow.reset()
    setReviewOpen(true)
  }

  function startMenu() {
    setDraft([
      {
        ...((draft[0] ?? {}) as Record<string, unknown>),
        sections: [
          {
            labels: [{ displayName: "" }],
            items: [{ labels: [{ displayName: "" }] }],
          },
        ],
      },
      ...draft.slice(1),
    ])
  }

  return (
    <EditorFrame
      title="Food menu"
      statusLabel={statusLabel}
      tone={
        noMenu && !isDirty
          ? "neutral"
          : changeCount > 0
            ? "attention"
            : "healthy"
      }
      description={
        <>
          Publishing replaces the whole food menu on Google, not only what you
          changed.{" "}
          <span className="font-mono tabular-nums">{draftCounts.sections}</span>{" "}
          {draftCounts.sections === 1 ? "section" : "sections"},{" "}
          <span className="font-mono tabular-nums">{draftCounts.items}</span>{" "}
          {draftCounts.items === 1 ? "item" : "items"}.
        </>
      }
      gateReason={editReason}
      footer={
        noMenu && !isDirty ? undefined : (
          <EditorFooter
            status={
              isDirty
                ? "edited"
                : state.status === "in_sync"
                  ? "in_sync"
                  : "unpublished"
            }
            // Drift already saved here is publishable too, as in Hours and
            // Profile; only local edits can be discarded.
            isDirty={isDirty || rows.length > 0}
            canDiscard={isDirty}
            onReview={review}
            onDiscard={() => setDiscardOpen(true)}
            onSave={saveHere}
            saving={save.isPending}
            saveDisabledReason={editReason}
            disabledReason={publishReason}
            hint={
              state.status === "in_sync"
                ? "This menu matches Google."
                : "Google holds a different menu. Review to see what differs."
            }
          />
        )
      }
    >
      <DraftNotices drafts={[editor]} noun="this menu" />

      {serverError ? (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <ValidationSummary
        errors={problems}
        focusKey={attempt}
        title={
          problems.length === 1
            ? "1 problem to fix before saving or publishing"
            : `${problems.length} problems to fix before saving or publishing`
        }
      />

      {noMenu ? (
        <div className="rounded-lg border border-line bg-surface">
          <Empty
            icon={<UtensilsCrossed aria-hidden />}
            titleAs="h3"
            title="No food menu yet"
            description={
              googleHasMenu
                ? `NabaPresence has no menu for ${state.location.name}, but Google has one with ${state.googleCounts.items} ${state.googleCounts.items === 1 ? "item" : "items"}. Start from Google’s menu, or start a new one here.`
                : `Neither NabaPresence nor Google has a food menu for ${state.location.name}. Start one here; nothing reaches Google until you publish.`
            }
            action={
              disabled ? undefined : (
                <>
                  {googleHasMenu ? (
                    <Button onClick={() => setDraft(state.googleMenus)}>
                      <DownloadIcon aria-hidden />
                      Start from Google’s menu
                    </Button>
                  ) : null}
                  <Button
                    variant={googleHasMenu ? "secondary" : "default"}
                    onClick={startMenu}
                  >
                    <Plus aria-hidden />
                    Start a menu
                  </Button>
                </>
              )
            }
          />
        </div>
      ) : (
        <MenuEditor
          menus={draft}
          onChange={setDraft}
          disabled={disabled}
          problems={problems}
        />
      )}

      <DiscardDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        description="The menu goes back to what NabaPresence last saved. Google is not affected."
        onConfirm={() => {
          discard()
          setChecked(false)
          setServerError(null)
        }}
      />

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
