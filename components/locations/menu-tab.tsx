"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { ImportReviewPanel } from "@/components/locations/import-review-panel"
import { MenuEditor } from "@/components/locations/menu-editor"
import { MenuPublishPreview } from "@/components/locations/menu-publish-preview"
import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { useToastManager } from "@/components/ui/toast"
import { publishFoodMenus, saveFoodMenus, type FoodMenu, type FoodMenusState } from "@/lib/api/location-menu"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/locations/action-errors"
import { countFoodMenus } from "@/lib/locations/forms/food-menus"
import { editDisabledReason, resourceDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useFoodMenus } from "@/lib/queries/use-location-menu"

export function MenuTab({ locationId }: { locationId: string }) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const menuQuery = useFoodMenus(locationId)
  const caps = useLocationCapabilities(locationId).data

  if (menuQuery.isPending) return <TabLoading />
  if (menuQuery.isError) return <TabError error={menuQuery.error} onRetry={() => menuQuery.refetch()} />

  const state = menuQuery.data
  if (!state.eligible) {
    return (
      <Empty
        title="This location can’t have a food menu"
        description="Google reports that this location type is not eligible for a food menu, so there’s nothing to manage here."
      />
    )
  }

  return (
    <MenuTabLoaded
      key={state.canonicalResource.revision}
      locationId={locationId}
      state={state}
      caps={caps}
      invalidate={() => void queryClient.invalidateQueries({ queryKey: queryKeys.locationMenu(locationId) })}
      toast={(title, type: "success" | "error") => toasts.add({ title, type })}
    />
  )
}

function MenuTabLoaded({
  locationId,
  state,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  state: FoodMenusState
  caps: { canEditCanonical: boolean; canPublish: boolean } | undefined
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [draft, setDraft] = useState<FoodMenu[]>(state.canonicalMenus)
  // Deviation from the brief's reference impl (`useEffect(() => setDraft(state.canonicalMenus),
  // [state.canonicalMenus])` — a bare setState effect body): react-hooks/set-state-in-effect
  // flags an effect whose body is nothing but a synchronous setState call. Mirrors the
  // ref-guard convention already used by components/locations/hours-tab.tsx (see
  // task-6-report.md) — only reset local edits when the canonical revision actually
  // advances (e.g. after a successful save/publish invalidates + refetches), not on
  // every incidental re-render of `state.canonicalMenus`.
  const revision = state.canonicalResource.revision
  const revisionRef = useRef(revision)
  useEffect(() => {
    if (revisionRef.current === revision) return
    revisionRef.current = revision
    setDraft(state.canonicalMenus)
  }, [state.canonicalMenus, revision])
  const [publishOpen, setPublishOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(state.canonicalMenus)
  useDirtyGuard({ key: `location-menu-${locationId}`, isDirty, snapshot: () => JSON.stringify(draft) })

  const save = useMutation({
    mutationFn: () => saveFoodMenus(locationId, { expectedCanonicalRevision: state.canonicalResource.revision, menus: draft }),
    onSuccess: () => {
      setServerError(null)
      invalidate()
      toast("Menu saved", "success")
    },
    // Nested per-field mapping is impractical for the freeform menu JSON, so
    // server errors surface in the form-level Alert (plus a toast). Carry-forward noted.
    onError: (error) => {
      setServerError(describeActionError(error))
      toast(describeActionError(error), "error")
    },
  })

  const publish = useMutation({
    mutationFn: () =>
      publishFoodMenus(locationId, {
        expectedCanonicalRevision: state.canonicalResource.revision,
        expectedCanonicalHash: state.canonicalHash,
        expectedGoogleHash: state.googleHash,
      }),
    onSuccess: () => {
      setPublishOpen(false)
      setServerError(null)
      invalidate()
      toast("Menu published to Google", "success")
    },
    onError: (error) => {
      setServerError(describeActionError(error))
      toast(describeActionError(error), "error")
    },
  })

  const editReason = editDisabledReason(caps)
  const publishReason =
    resourceDisabledReason(caps, "menu", state.writesEnabled) ?? (state.status === "in_sync" ? "Menu already matches Google." : isDirty ? "Save your changes before publishing." : null)
  const draftCounts = countFoodMenus(draft as Array<Record<string, unknown>>)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={state.status === "in_sync" ? "secondary" : "warning"}>
          {state.status === "in_sync" ? "In sync with Google" : "You have unpublished changes"}
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

      <MenuEditor menus={draft} onChange={setDraft} disabled={Boolean(editReason)} />

      {serverError ? (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={Boolean(editReason) || !isDirty || save.isPending}>
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
