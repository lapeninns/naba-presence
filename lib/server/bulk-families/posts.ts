import "server-only"

import type { TransactionSql } from "postgres"

import type { BulkPostDraftInput } from "@/lib/domain/bulk-menus"
import type { BulkOperationInput } from "@/lib/domain/bulk-merge"
import type { BulkFamily } from "@/lib/server/bulk-families/types"
import {
  assertContentChecks,
  postOfferEndDate,
} from "@/lib/server/content-checks"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { insertLocalPostDraft } from "@/lib/server/posts"

/**
 * The content checks of a batch's post drafts, at preview, in the caller's
 * tenant transaction: the same checks (and the same consent) as a single
 * post's save (`insertLocalPostDraft`). A fail refuses the whole preview
 * (422 `content_checks_failed`); a warning without the person's consent
 * refuses it with the reasons and the consent token to acknowledge (409
 * `content_warning_acknowledgement_required`). Both name the change
 * (`details.item`, its index in the batch) so the composer can show them
 * beside it. The consent covers every listing: it binds the text, the
 * organisation's policy and the warnings, none of which differ between
 * listings.
 *
 * The acknowledged token is part of the change itself
 * (`post.contentWarningAcknowledgement`), so it is frozen into the preview,
 * covered by its approval, and carried into each child, whose draft insert
 * checks it again: a policy change between preview and execution fails the
 * child with nothing drafted, and a new preview asks again.
 */
export async function assertBulkPostContent(
  sql: TransactionSql,
  items: readonly BulkOperationInput[]
) {
  for (const [item, change] of items.entries()) {
    if (change.operation !== "post_draft") continue
    const { post } = change
    try {
      await assertContentChecks(sql, {
        kind: "post",
        body: post.summary,
        allowEmpty: post.media.length > 0,
        offerEndDate: postOfferEndDate(post),
        contentWarningAcknowledgement: post.contentWarningAcknowledgement,
      })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      throw new ApiError(error.status, error.code, error.message, {
        details: { ...(error.details as Record<string, unknown>), item },
      })
    }
  }
}

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
