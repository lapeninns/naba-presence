import type {
  Review,
  ReviewStatus,
  VerificationStatus,
} from "@/lib/naba-presence-data"
import type { DraftTone } from "@/lib/domain/reply-policy"

type ApiReview = {
  id: string
  location: { id: string; name: string }
  reviewer: { displayName: string | null; isAnonymous: boolean }
  rating: number
  text: string | null
  detectedLanguageCode: string | null
  languageConfidence: number | null
  createTime: string
  updateTime: string
  workflowStatus: string
  verificationStatus: string | null
  replyStatus: string | null
  googleReplyState: "APPROVED" | "PENDING" | null
  googlePolicyViolation: string | null
  replyBody: string | null
  syncStatus: string | null
  draftId: string | null
  draftBody: string | null
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

function statusOf(value: string): ReviewStatus {
  if (value === "published") return "published"
  if (value === "awaiting_approval" || value === "publish_requested") {
    return "awaiting_approval"
  }
  if (value === "escalated" || value === "rejected" || value === "failed") {
    return "escalated"
  }
  return "needs_reply"
}

function verificationOf(value: string | null): VerificationStatus {
  return value === "pass" ||
    value === "warn" ||
    value === "fail" ||
    value === "pending"
    ? value
    : "pending"
}

function displayDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value))
}

function apiMessage(payload: unknown, fallback: string) {
  return payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
    ? payload.message
    : fallback
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const payload = response.status === 204 ? null : await response.json()
  if (!response.ok) {
    throw new Error(apiMessage(payload, "The request could not be completed."))
  }
  return payload as T
}

export type AppSession = {
  sessionId: string
  userId: string
  organisationId: string
  organisationName: string
  displayName: string
  email: string
  role: "owner" | "admin" | "member" | "viewer"
  canPublish: boolean
}

export async function loadSession() {
  return apiFetch<{ session: AppSession | null }>("/api/session")
}

async function requireApiSession() {
  const { session } = await loadSession()
  if (!session) {
    throw new Error("Sign in to use live organisation data.")
  }
}

export type ReviewFilters = {
  locationId?: string
  ratings?: number[]
  statuses?: string[]
  replyStates?: string[]
  verificationStatuses?: string[]
  publishStatuses?: string[]
  syncStatuses?: string[]
  dateFrom?: string
  dateTo?: string
  search?: string
  sort?: "updated_desc" | "rating_desc" | "rating_asc"
}

function appendList(
  params: URLSearchParams,
  name: string,
  values: Array<string | number> | undefined
) {
  if (values?.length) params.set(name, values.join(","))
}

export async function loadReviewsPage(
  filters: ReviewFilters = {},
  cursor?: string
): Promise<{ items: Review[]; nextCursor: string | null }> {
  await requireApiSession()
  const params = new URLSearchParams({ page_size: "50" })
  if (filters.locationId) params.set("location_id", filters.locationId)
  appendList(params, "rating", filters.ratings)
  appendList(params, "status", filters.statuses)
  appendList(params, "reply_state", filters.replyStates)
  appendList(params, "verification", filters.verificationStatuses)
  appendList(params, "publish_status", filters.publishStatuses)
  appendList(params, "sync_status", filters.syncStatuses)
  if (filters.dateFrom) params.set("date_from", filters.dateFrom)
  if (filters.dateTo) params.set("date_to", filters.dateTo)
  if (filters.search) params.set("search", filters.search)
  if (filters.sort) params.set("sort", filters.sort)
  if (cursor) params.set("cursor", cursor)
  const [{ items, nextCursor }, { settings }] = await Promise.all([
    apiFetch<{ items: ApiReview[]; nextCursor: string | null }>(
      `/api/reviews?${params}`
    ),
    apiFetch<{ settings: OrganisationSettings }>("/api/settings"),
  ])
  const timeZone = settings.defaultTimezone ?? "Europe/London"
  return {
    items: items.map((item) => {
      const reviewer = item.reviewer.displayName ?? "Anonymous reviewer"
      return {
        id: item.id,
        reviewer,
        initials: initials(reviewer) || "AR",
        rating: item.rating,
        location: item.location.name,
        locationId: item.location.id,
        excerpt: item.text ?? "Rating-only review",
        text:
          item.text ?? "This reviewer left a star rating without a comment.",
        postedAt: displayDate(item.createTime, timeZone),
        updatedAt: displayDate(item.updateTime, timeZone),
        language:
          item.detectedLanguageCode && (item.languageConfidence ?? 0) >= 0.7
            ? item.detectedLanguageCode.toUpperCase()
            : `${settings.defaultLanguageCode.toUpperCase()} fallback`,
        status: statusOf(item.workflowStatus),
        verification: verificationOf(item.verificationStatus),
        draft: item.draftBody ?? item.replyBody ?? "",
        publishedReply: item.replyBody ?? undefined,
        draftId: item.draftId ?? undefined,
        sourceUpdateTime: item.updateTime,
        sourceCreateTime: item.createTime,
        replyStatus: item.replyStatus ?? "not_published",
        syncStatus: item.syncStatus ?? "pending",
        responseTime:
          item.replyStatus === "published" ? "Published" : undefined,
        googleState: item.googleReplyState ?? undefined,
      }
    }),
    nextCursor,
  }
}

export async function loadReviews(): Promise<Review[]> {
  return (await loadReviewsPage()).items
}

export type ReviewDetailData = {
  media: Array<{
    id: string
    thumbnailUrl: string | null
    thumbnailLabel: string | null
    videoUrl: string | null
  }>
  reply: {
    publishStatus: string
    googleReplyState: string | null
    googlePolicyViolation: string | null
  } | null
  timeline: Array<{
    action: string
    actorUserId: string | null
    createdAt: string
  }>
}

export async function loadReviewDetail(
  reviewId: string
): Promise<ReviewDetailData> {
  await requireApiSession()
  const [{ review }, { settings }] = await Promise.all([
    apiFetch<{ review: ReviewDetailData }>(`/api/reviews/${reviewId}`),
    apiFetch<{ settings: OrganisationSettings }>("/api/settings"),
  ])
  return {
    ...review,
    timeline: review.timeline.map((event) => ({
      ...event,
      createdAt: displayDate(
        event.createdAt,
        settings.defaultTimezone ?? "Europe/London"
      ),
    })),
  }
}

export async function generateDraft(
  reviewId: string,
  tone: DraftTone = "warm_professional"
) {
  const result = await apiFetch<{
    draftId: string
    body: string
    verification: { verdict: VerificationStatus }
  }>(`/api/reviews/${reviewId}/drafts`, {
    method: "POST",
    body: JSON.stringify({ tone }),
  })
  return result
}

export async function saveDraft(
  reviewId: string,
  body: string,
  tone: DraftTone = "warm_professional"
) {
  return apiFetch<{
    draftId: string
    body: string
    verification: { verdict: VerificationStatus }
  }>(`/api/reviews/${reviewId}/drafts`, {
    method: "POST",
    body: JSON.stringify({ tone, body }),
  })
}

export async function publishDraft(
  reviewId: string,
  draftId: string,
  sourceUpdateTime?: string
) {
  return apiFetch<{
    status: "awaiting_approval" | "published" | "accepted" | "rejected"
    googleReplyState: "PENDING" | "APPROVED" | "REJECTED" | null
  }>(`/api/reviews/${reviewId}/publish`, {
    method: "POST",
    body: JSON.stringify({
      draftId,
      expectedReviewUpdateTime: sourceUpdateTime,
    }),
  })
}

export type GoogleConnection = {
  id: string
  googleEmail: string | null
  status: string
  scope: string
  notificationsEnabled: boolean
  lastRefreshAt: string | null
  lastErrorCode: string | null
  reconnectRequired: boolean
  createdAt: string
}

export type GoogleLocation = {
  id: string
  name: string
  title?: string
  accountName: string
  verified: boolean
  storefrontAddress?: {
    addressLines?: string[]
    locality?: string
    administrativeArea?: string
    postalCode?: string
    regionCode?: string
  }
}

export type GoogleAccount = {
  id: string
  googleAccountName: string
  accountName: string | null
  type: string | null
  role: string | null
  permissionLevel: string | null
  isActive: boolean
}

export async function loadConnections() {
  await requireApiSession()
  return apiFetch<{ connections: GoogleConnection[] }>(
    "/api/google/connections"
  )
}

export async function beginGoogleConnect() {
  return apiFetch<{ authorizationUrl: string }>("/api/google/connect/start", {
    method: "POST",
  })
}

export async function disconnectGoogle(connectionId: string) {
  return apiFetch<{ status: string }>(
    `/api/google/connections/${connectionId}/disconnect`,
    { method: "POST" }
  )
}

export async function discoverGoogleAccounts() {
  return apiFetch<{ accounts: GoogleAccount[] }>("/api/google/accounts")
}

export async function activateGoogleAccounts(accountIds: string[]) {
  return apiFetch<{ accounts: GoogleAccount[] }>("/api/google/accounts", {
    method: "PATCH",
    body: JSON.stringify({ accountIds }),
  })
}

export async function discoverGoogleLocations() {
  return apiFetch<{ locations: GoogleLocation[] }>("/api/google/locations")
}

export async function linkGoogleLocation(
  location: GoogleLocation,
  options: { locationId?: string; confirmRelink?: boolean } = {}
) {
  return apiFetch("/api/location-links", {
    method: "POST",
    body: JSON.stringify({
      externalLocationId: location.id,
      locationId: options.locationId,
      name: options.locationId ? undefined : (location.title ?? location.name),
      timezone: "Europe/London",
      confirmRelink: options.confirmRelink ?? false,
    }),
  })
}

export type BackfillProgress = {
  items: Array<{
    externalLocationId: string
    locationName: string
    status:
      | "not_started"
      | "pending"
      | "running"
      | "succeeded"
      | "failed"
      | "cancelled"
    attemptCount: number
    hasMorePages: boolean
    lastErrorCode: string | null
    startedAt: string | null
    finishedAt: string | null
    nextAttemptAt: string | null
  }>
  counts: Record<string, number>
  total: number
}

export async function runBackfill(
  externalLocationId: string,
  maxPagesPerLocation = 10
) {
  return apiFetch<{
    batches: Array<{
      externalLocationIds: string[]
      upserted?: number
      pages?: number
      complete?: boolean
      error?: { code: string; message: string }
    }>
    progress: BackfillProgress
  }>("/api/sync/backfill", {
    method: "POST",
    body: JSON.stringify({
      externalLocationIds: [externalLocationId],
      maxPagesPerLocation,
    }),
  })
}

export async function loadBackfillProgress() {
  await requireApiSession()
  return apiFetch<{ progress: BackfillProgress }>("/api/sync/backfill")
}

export async function cancelBackfill(externalLocationId: string) {
  return apiFetch<{
    cancelledExternalLocationIds: string[]
    progress: BackfillProgress
  }>("/api/sync/backfill", {
    method: "DELETE",
    body: JSON.stringify({ externalLocationIds: [externalLocationId] }),
  })
}

export async function configureGoogleNotifications(
  accountId: string,
  pubsubTopic: string
) {
  return apiFetch("/api/google/notifications", {
    method: "PATCH",
    body: JSON.stringify({ accountId, pubsubTopic }),
  })
}

export type OrganisationSettings = {
  approvalRequired: boolean
  rawContentRetentionDays: number
  defaultLanguageCode: string
  defaultTimezone: string
  directPublishConsent?: boolean
  directPublishConsentAt?: string | null
}

export async function loadSettings() {
  await requireApiSession()
  return apiFetch<{ settings: OrganisationSettings }>("/api/settings")
}

export async function saveSettings(settings: OrganisationSettings) {
  return apiFetch<{ settings: OrganisationSettings }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  })
}

export type OrganisationMember = {
  userId: string
  email: string
  displayName: string
  role: "owner" | "admin" | "member" | "viewer"
  canPublish: boolean
  locations: Array<{ locationId: string; canPublish: boolean }>
}

export async function loadMembers() {
  await requireApiSession()
  return apiFetch<{ members: OrganisationMember[] }>("/api/members")
}

export async function addMember(input: {
  email: string
  displayName: string
  role: OrganisationMember["role"]
  canPublish: boolean
}) {
  return apiFetch<{ member: OrganisationMember }>("/api/members", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateMember(input: {
  userId: string
  role: OrganisationMember["role"]
  canPublish: boolean
}) {
  return apiFetch<{ member: OrganisationMember }>("/api/members", {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function saveLocationAssignments(
  userId: string,
  assignments: Array<{ locationId: string; canPublish: boolean }>
) {
  return apiFetch<{ assignments: typeof assignments }>(
    "/api/location-members",
    {
      method: "PUT",
      body: JSON.stringify({ userId, assignments }),
    }
  )
}

export type InternalLocation = {
  locationId: string
  name: string
  timezone: string
  address: GoogleLocation["storefrontAddress"] | null
  linkId: string | null
  externalLocationId: string | null
  googleLocationName: string | null
  googleTitle: string | null
  verified: boolean | null
}

export async function loadInternalLocations() {
  await requireApiSession()
  return apiFetch<{ locations: InternalLocation[] }>("/api/location-links")
}

export async function createPrivacyRequest(input: {
  requestType: "access" | "rectification" | "erasure" | "restriction"
  subjectReference: string
  reason?: string
}) {
  return apiFetch<{ request: { id: string; status: string } }>(
    "/api/privacy/requests",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  )
}

export type AnalyticsOverview = {
  from: string
  to: string
  summary: {
    reviewVolume: number
    averageRating: number | null
    responseRate: number | null
    unresolvedComplaints: number
    verificationFailures: number
    verificationRejectionRate: number | null
    medianResponseSeconds: number | null
    p95ResponseSeconds: number | null
  }
  series: Array<{
    period: string
    reviews: number
    replies: number
    averageRating: number | null
  }>
  locations: Array<{
    id: string
    name: string
    reviews: number
    averageRating: number | null
    responseRate: number | null
    medianResponseSeconds: number | null
    p95ResponseSeconds: number | null
    unresolvedComplaints: number
    verificationRejectionRate: number | null
  }>
}

export async function loadAnalytics(options?: {
  from?: string
  to?: string
  granularity?: "day" | "week" | "month"
}) {
  await requireApiSession()
  const params = new URLSearchParams()
  if (options?.from) params.set("from", options.from)
  if (options?.to) params.set("to", options.to)
  if (options?.granularity) params.set("granularity", options.granularity)
  const query = params.size ? `?${params}` : ""
  return apiFetch<AnalyticsOverview>(`/api/analytics/overview${query}`)
}
