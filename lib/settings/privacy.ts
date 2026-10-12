import type {
  PrivacyExportResponse,
  PrivacyRequest,
  RetentionCycleOrganisation,
} from "@/lib/contracts/privacy"
import type { StatusTone } from "@/lib/ui/status-tone"

/**
 * Presentation rules for the Data and privacy settings area (plan P04-7).
 * Pure and client-safe, so the panels and their tests share them.
 */

const OPEN = new Set(["pending", "in_progress"])

export function isOpenRequest(
  request: Pick<PrivacyRequest, "status">
): boolean {
  return OPEN.has(request.status)
}

/**
 * An erasure already carried out here whose replies are still being
 * withdrawn from Google, retrying or stalled. It can only be finished by
 * fulfilling it again (or by the job tick): PATCH refuses to close it by
 * status (`privacy_withdrawal_pending`), so the panel offers no Reject.
 */
export function hasPendingWithdrawal(
  request: Pick<
    PrivacyRequest,
    "status" | "withdrawalStalled" | "nextAttemptAt"
  >
): boolean {
  if (request.withdrawalStalled) return true
  return request.status === "in_progress" && Boolean(request.nextAttemptAt)
}

/**
 * Overdue as the server reports it (`overdue`), or, for a row the server
 * has not re-read since its deadline passed, an open request whose `dueAt`
 * is behind `now`.
 */
export function isOverdue(
  request: PrivacyRequest,
  now: Date = new Date()
): boolean {
  if (request.overdue) return true
  if (!isOpenRequest(request) || !request.dueAt) return false
  return new Date(request.dueAt).getTime() < now.getTime()
}

function rank(request: PrivacyRequest): number {
  if (request.withdrawalStalled) return 0
  return isOpenRequest(request) ? 1 : 2
}

function time(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY
}

/**
 * Mirrors GET /api/privacy/requests' order: stalled withdrawals first, then
 * open requests closest to their deadline, then resolved ones newest first.
 * The list is sorted again here so a row patched into the cache after a
 * fulfil cannot sit out of place until the next refetch.
 */
export function sortPrivacyRequests(
  requests: readonly PrivacyRequest[]
): PrivacyRequest[] {
  return [...requests].sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    if (rank(a) < 2) {
      const byDue = time(a.dueAt) - time(b.dueAt)
      if (byDue !== 0) return byDue
    }
    return time(b.createdAt) - time(a.createdAt)
  })
}

export type RequestPresentation = {
  label: string
  tone: StatusTone
  /** A sentence under the pill, or null. */
  detail: string | null
}

const STATUS_PRESENTATION: Record<string, { label: string; tone: StatusTone }> =
  {
    pending: { label: "Pending", tone: "pending" },
    in_progress: { label: "In progress", tone: "pending" },
    completed: { label: "Completed", tone: "healthy" },
    rejected: { label: "Rejected", tone: "neutral" },
  }

export function presentPrivacyRequest(
  request: PrivacyRequest,
  now: Date = new Date()
): RequestPresentation {
  if (request.withdrawalStalled) {
    const attempts = request.withdrawalAttempts ?? 0
    return {
      label: "Withdrawal stalled",
      tone: "at-risk",
      detail:
        `A reply could not be withdrawn from Google${attempts ? ` after ${attempts} ${attempts === 1 ? "attempt" : "attempts"}` : ""}` +
        `${request.lastErrorCode ? ` (${request.lastErrorCode})` : ""}. Nothing will retry it: fulfil the request again to take it over.`,
    }
  }
  const base = STATUS_PRESENTATION[request.status] ?? {
    label: request.status,
    tone: "neutral" as const,
  }
  const retrying =
    request.status === "in_progress" && Boolean(request.nextAttemptAt)
  const detail = retrying
    ? "Local records are erased. A reply is still being withdrawn from Google; it is retried automatically."
    : null
  if (isOverdue(request, now)) {
    return { label: "Overdue", tone: "at-risk", detail }
  }
  return { ...base, detail }
}

/** What fulfilling a request of each type does, for the confirm dialog. */
export function fulfilDescription(requestType: string): string {
  switch (requestType) {
    case "erasure":
      return "Erases the matching reviews’ content, photos, drafts and reply text here, and withdraws our replies to them from Google. Reviews under a legal hold block it."
    case "restriction":
      return "Marks the matching reviews as restricted from further processing."
    case "access":
      return "Records the request as answered. Export the subject’s records below and send them before you fulfil it."
    case "rectification":
      return "Records the verified correction. Google holds the review itself, so nothing is changed there."
    default:
      return "Records the request as fulfilled."
  }
}

export function retentionOrganisationLabel(
  organisation: RetentionCycleOrganisation | null
): { label: string; tone: StatusTone } {
  if (!organisation) return { label: "Not yet reached", tone: "neutral" }
  switch (organisation.status) {
    case "succeeded":
      return { label: "Retained", tone: "healthy" }
    case "failed":
      return {
        label: `Not retained${organisation.lastErrorCode ? ` (${organisation.lastErrorCode})` : ""}`,
        tone: "at-risk",
      }
    default:
      return { label: "Waiting", tone: "pending" }
  }
}

/** One subject export, assembled from every page the route served. */
export type SubjectExport = {
  generatedAt: string
  organisationId: string
  subjectReference: string
  note: string
  totalMatched: number
  pages: number
  complete: boolean
  addedDuringExport: number
  reviews: PrivacyExportResponse["reviews"]
}

/**
 * Concatenates export pages in the order they were served. The summary
 * fields come from the last page: it carries the final `complete` and
 * `addedDuringExport` verdicts, and `totalMatched` is recounted on every
 * page. `generatedAt` is the first page's, when the export began.
 */
export function assembleSubjectExport(
  pages: readonly PrivacyExportResponse[]
): SubjectExport {
  const first = pages[0]
  const last = pages[pages.length - 1]
  if (!first || !last) throw new Error("An export needs at least one page.")
  return {
    generatedAt: first.generatedAt,
    organisationId: last.organisationId,
    subjectReference: last.subjectReference,
    note: last.note,
    totalMatched: last.totalMatched,
    pages: pages.length,
    complete: last.nextCursor === null && last.complete,
    addedDuringExport: last.addedDuringExport,
    reviews: pages.flatMap((page) => page.reviews),
  }
}

/** A filename that carries no part of the subject reference. */
export function exportFilename(generatedAt: string): string {
  return `privacy-export-${generatedAt.slice(0, 10)}.json`
}
