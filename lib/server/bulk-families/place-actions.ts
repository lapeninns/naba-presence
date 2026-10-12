import "server-only"

import type { BulkOperationInput } from "@/lib/domain/bulk-merge"
import {
  placeActionApplied,
  placeActionState,
  planPlaceAction,
  type PlaceActionPlan,
  type PlaceLink,
} from "@/lib/domain/bulk-place-actions"
import type { GooglePlaceActionType } from "@/lib/domain/google-contract"
import {
  outcomeOfThrownWrite,
  reconcileFromReceipt,
} from "@/lib/server/bulk-families/shared"
import type { BulkFamily } from "@/lib/server/bulk-families/types"
import { runBulkWrite } from "@/lib/server/bulk-families/write-attempts"
import {
  stableGoogleHash,
  type GbpLocationContext,
} from "@/lib/server/gbp-management"
import {
  createGooglePlaceActionLink,
  deleteGooglePlaceActionLink,
  listGooglePlaceActionLinks,
  patchGooglePlaceActionLink,
} from "@/lib/server/google"
import { listGooglePlaceActionMetadata } from "@/lib/server/google/place-action-metadata"

type PlaceActionInput = Extract<
  BulkOperationInput,
  { operation: "place_action" }
>

async function readLinks(linked: GbpLocationContext, type: string) {
  const collection = await listGooglePlaceActionLinks(
    await linked.accessToken(),
    linked.googleLocationName,
    { connectionKey: linked.connectionId }
  )
  return placeActionState(collection.links, type)
}

/**
 * Action links by type and Google link name, never by URI
 * (lib/domain/bulk-place-actions.ts). Provider-owned links are never
 * changed. Runs inside the Google account change lock, after the same
 * unresolved-outcome guard reviewed action links take.
 */
export const placeActionsFamily: BulkFamily<PlaceActionInput> = {
  operations: ["place_action"],
  resourceKey: "place_actions",
  writeSurface: "placeActions",
  accountLock: true,
  async plan(input, linked, reads) {
    const options = { connectionKey: linked.connectionId }
    const [metadata, collection] = await Promise.all([
      reads.once("place_actions:metadata", async () =>
        listGooglePlaceActionMetadata(
          await linked.accessToken(),
          linked.googleLocationName,
          options
        )
      ),
      reads.once("place_actions:links", async () =>
        listGooglePlaceActionLinks(
          await linked.accessToken(),
          linked.googleLocationName,
          options
        )
      ),
    ])
    const current = placeActionState(collection.links, input.placeActionType)
    const decision = planPlaceAction(input, current, metadata.supportedTypes)
    if ("skip" in decision)
      return { eligible: false, reason: decision.skip, current }
    return {
      eligible: true,
      current,
      proposed: decision.plan,
      updateMask: decision.updateMask,
    }
  },
  async dispatch(context) {
    const { input, linked } = context
    const plan = context.proposed as PlaceActionPlan
    const priorNames = (context.current as PlaceLink[]).map((link) => link.name)
    let observed: PlaceLink[]
    try {
      observed = await readLinks(linked, input.placeActionType)
    } catch (error) {
      return outcomeOfThrownWrite(
        context.organisationId,
        context.intentId,
        error
      )
    }
    if (placeActionApplied(observed, plan, priorNames))
      return { kind: "succeeded", confirmation: "confirmed", observed }
    if (stableGoogleHash(observed) !== context.baselineHash)
      return { kind: "conflict", code: "google_baseline_changed", observed }
    if (!context.stillOpen()) return { kind: "expired" }
    const options = { connectionKey: linked.connectionId }
    const typed = (payload: { uri: string; isPreferred: boolean }) => ({
      ...payload,
      placeActionType: input.placeActionType as GooglePlaceActionType,
    })
    return runBulkWrite(context, {
      family: "place_action",
      surface: "place_actions",
      action:
        "delete" in plan ? "delete" : "update" in plan ? "update" : "create",
      writeSurface: "placeActions",
      intended: { placeActionType: input.placeActionType, plan, priorNames },
      mutate: async () => {
        const token = await linked.accessToken()
        if ("delete" in plan)
          return deleteGooglePlaceActionLink(token, plan.delete, options)
        if ("update" in plan)
          return patchGooglePlaceActionLink(
            token,
            { name: plan.update, payload: typed(plan.payload) },
            options
          )
        return createGooglePlaceActionLink(
          token,
          {
            locationName: linked.googleLocationName,
            payload: typed(plan.create),
          },
          options
        )
      },
      read: () => readLinks(linked, input.placeActionType),
      verify: (links) => placeActionApplied(links, plan, priorNames),
    })
  },
  reconcile: reconcileFromReceipt,
}
