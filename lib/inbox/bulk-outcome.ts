import type {
  BulkReviewResult,
  BulkReviewRowStatus,
} from "@/lib/contracts/reviews"

/**
 * How the bulk bar names each row outcome. "Skipped" is kept for rows where
 * nothing changed; an approval that was recorded but did not reach Google
 * says so, because the operator has to know the decision stands.
 */
export const BULK_ROW_STATUS_LABEL: Record<BulkReviewRowStatus, string> = {
  ok: "Done",
  skipped: "Skipped",
  failed: "Failed",
  approved_not_published: "Approved, not published",
  uncertain: "Check on Google",
  queued: "Queued",
}

export type BulkOutcomeSummary = {
  title: string
  description: string | undefined
  tone: "success" | "warning" | "error"
  /** Every row took effect, so the selection can be cleared. */
  allOk: boolean
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * One line for the toast that never rounds a mixed batch to "updated" or
 * "skipped": each kind of outcome is counted under its own name.
 */
export function summariseBulkOutcome(
  result: BulkReviewResult
): BulkOutcomeSummary {
  const count = (status: BulkReviewRowStatus) =>
    result.results.filter((row) => row.status === status).length
  const ok = count("ok")
  const skipped = count("skipped")
  const failed = count("failed")
  const notPublished = count("approved_not_published")
  const uncertain = count("uncertain")
  const queued = count("queued")

  // Sent by the job runner: the batch page follows each one to its end,
  // whether or not this tab stays open.
  if (queued > 0) {
    const others = [
      skipped > 0 ? `${skipped} skipped` : null,
      failed > 0 ? `${failed} failed` : null,
    ].filter((part): part is string => part !== null)
    return {
      title: [`${plural(queued, "reply", "replies")} queued`, ...others].join(
        ", "
      ),
      description:
        "They are sent in the background. Follow them on the batch page, even after closing this tab.",
      tone: failed > 0 ? "error" : others.length > 0 ? "warning" : "success",
      allOk: others.length === 0,
    }
  }

  if (ok === result.results.length) {
    return {
      title: `${plural(ok, "review", "reviews")} updated`,
      description: undefined,
      tone: "success",
      allOk: true,
    }
  }

  const parts = [
    ok > 0 ? `${ok} updated` : null,
    notPublished > 0 ? `${notPublished} approved but not published` : null,
    uncertain > 0 ? `${uncertain} may have reached Google` : null,
    skipped > 0 ? `${skipped} skipped` : null,
    failed > 0 ? `${failed} failed` : null,
  ].filter((part): part is string => part !== null)

  return {
    title: parts.join(", "),
    description:
      uncertain > 0
        ? "Check those replies on Google before trying again. The bar lists which, and why."
        : "The bar lists which, and why.",
    tone: uncertain > 0 || failed > 0 ? "error" : "warning",
    allOk: false,
  }
}
