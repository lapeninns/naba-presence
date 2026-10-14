import {
  mutationReceiptParamsSchema,
  type MutationReceiptResponse,
} from "@/lib/contracts/mutation-operations"
import { settleInterruptedListingChanges } from "@/lib/server/listing-changes"
import { loadMutationReceipt } from "@/lib/server/mutation-operations"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * The receipt for one change: what happened to the write recorded under an
 * operation id, or under the intent id the client sent as `Idempotency-Key`
 * (so a client that lost the answer can still ask). Tenant-scoped; a receipt
 * for a location the member cannot see is a 404 like a missing one.
 */
export const GET = route({
  maxDuration,
  params: mutationReceiptParamsSchema,
  handler: async ({
    session,
    params,
    tenant,
  }): Promise<MutationReceiptResponse> => ({
    operation: await tenant(async (sql) => {
      // An approved listing change whose dispatch was interrupted before it
      // claimed an attempt answers `failed` rather than `sent` for good.
      await settleInterruptedListingChanges(sql, {
        organisationId: session.organisationId,
        ids: [params.operationId],
      })
      return loadMutationReceipt(sql, session, params.operationId)
    }),
  }),
})
