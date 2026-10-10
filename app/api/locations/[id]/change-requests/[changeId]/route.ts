import {
  listingChangeDecisionBodySchema,
  listingChangeParamsSchema,
  type ListingChangeDecisionResponse,
} from "@/lib/contracts/listing-changes"
import { decideListingChange } from "@/lib/server/listing-change-registry"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// An approval dispatches the frozen write, which may read Google, validate,
// write and read back, like the editor routes it stands in for.
export const maxDuration = 60

/**
 * Approve (and send) or reject one listing change request. The decider needs
 * `decide_approval` at the location and must not be the request's author;
 * the author may reject their own request, which withdraws it.
 */
export const POST = route({
  params: listingChangeParamsSchema,
  body: listingChangeDecisionBodySchema,
  handler: async ({ session, params, body, requestId }) =>
    (await decideListingChange({
      session,
      locationId: params.id,
      changeId: params.changeId,
      decision: body.decision,
      payloadHash: body.payloadHash,
      requestId,
    })) satisfies ListingChangeDecisionResponse,
})
