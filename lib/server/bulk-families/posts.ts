import "server-only"

import type { BulkPostDraftInput } from "@/lib/domain/bulk-menus"
import type { BulkFamily } from "@/lib/server/bulk-families/types"
import { withTenant } from "@/lib/server/db"
import { insertLocalPostDraft } from "@/lib/server/posts"

/**
 * Posts: each listing gets its own, independent local draft
 * (`insertLocalPostDraft`, the path `createLocalPostDraft` takes), authored
 * by the batch's requester. Nothing is sent to Google: the batch approval
 * covers creating the drafts, and each draft is published from the
 * listing's posts, with its own approval under two-person policy
 * (`requestOrPublishLocalPost`), so the author can never approve it.
 *
 * Exactly once per child: the draft's id is recorded on the child in the
 * transaction that inserts it, under a row lock, so a re-run claim (a
 * crashed tick, a retry) finds it instead of drafting again.
 */
export const postDraftsFamily: BulkFamily<BulkPostDraftInput> = {
  operations: ["post_draft"],
  resourceKey: "posts",
  writeSurface: null,
  accountLock: false,
  async plan(input) {
    return {
      eligible: true,
      current: null,
      proposed: {
        topicType: input.post.topicType,
        languageCode: input.post.languageCode,
        summary: input.post.summary,
      },
      updateMask: ["localPost"],
    }
  },
  async dispatch(context) {
    if (!context.stillOpen()) return { kind: "expired" }
    const postId = await withTenant(context.organisationId, async (sql) => {
      const [child] = await sql<{ postId: string | null }[]>`
        select local_post_id::text as "postId" from bulk_listing_child
        where id = ${context.childId} for update`
      if (child?.postId) return child.postId
      const post = await insertLocalPostDraft(sql, {
        organisationId: context.organisationId,
        locationId: context.locationId,
        externalLocationId: context.linked.externalLocationId,
        input: context.input.post,
        authorUserId: context.requestedBy,
        actorUserId: context.session.userId,
        requestId: context.requestId,
        metadata: {
          bulkOperationId: context.operationId,
          approvalRef: context.approvalRef,
        },
      })
      await sql`update bulk_listing_child set local_post_id = ${post.id} where id = ${context.childId}`
      return post.id
    })
    return {
      kind: "succeeded",
      confirmation: "confirmed",
      observed: { postId, status: "draft" },
    }
  },
  // Nothing is sent, so nothing is ever left unresolved.
  reconcile: () => null,
}
