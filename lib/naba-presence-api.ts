import type {
  Review,
  ReviewStatus,
  VerificationStatus,
} from "@/lib/naba-presence-data"
import type { DraftTone } from "@/lib/domain/reply-policy"
import type { ReviewWorkflowState } from "@/lib/domain/workflow"
import type {
  HoursDriftStatus,
  NormalizedHours,
} from "@/lib/domain/hours"
import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import type {
  ProfileDriftStatus,
  ProfileFieldKey,
  ProfileFieldPolicy,
} from "@/lib/domain/profile"

type ApiReview = {
  id: string
  location: { id: string; name: string }
  reviewer: { displayName: string | null; isAnonymous: boolean }
  rating: number | null
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
      ...(typeof init?.body === "string"
        ? { "content-type": "application/json" }
        : {}),
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

export type HoursViewState = {
      location: {
        id: string
        name: string
        googleLocationName: string
        timezone: string
      }
      canonicalResource: {
        revision: string
        updatedAt: string
      }
      status: HoursDriftStatus
      canonical: NormalizedHours
      google: NormalizedHours
      canonicalHash: string
      googleHash: string
      updateMask: GoogleHoursUpdateMask[]
      warnings: string[]
      canPublish: boolean
      writesEnabled: boolean
      lastReconciledAt: string | null
      latestAttempt: {
        id: string
        status: string
        createdAt: string
        finishedAt: string | null
      } | null
}

export async function loadLocationHours(locationId: string) {
  return apiFetch<{ hours: HoursViewState }>(
    `/api/locations/${locationId}/hours`
  )
}

export async function saveLocationHours(
  locationId: string,
  input: {
    expectedCanonicalRevision: string
    hours: NormalizedHours
  }
) {
  return apiFetch<{ saved: true; revision: string }>(
    `/api/locations/${locationId}/hours`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    }
  )
}

export async function publishLocationHours(
  locationId: string,
  input: {
    expectedCanonicalRevision: string
    expectedCanonicalHash: string
    expectedGoogleHash: string
    approvedUpdateMask: GoogleHoursUpdateMask[]
    confirmOverwriteGoogleChanges: boolean
  }
) {
  return apiFetch<{
    status: "published" | "in_sync"
    attemptId?: string
    idempotent: boolean
  }>(`/api/locations/${locationId}/hours`, {
    method: "POST",
    body: JSON.stringify({
      confirmation: "publish_nabapresence_hours_to_google",
      ...input,
    }),
  })
}

export type ProfileViewState = {
      location: { id: string; name: string; googleLocationName: string }
      canonicalResource: { revision: string; updatedAt: string }
      canonicalHash: string
      googleHash: string
      canPublish: boolean
      googleWritesEnabled: boolean
      fields: Array<{
        key: ProfileFieldKey
        policy: ProfileFieldPolicy
        status: ProfileDriftStatus
        canonicalValue: string | null
        googleValue: string | null
        canonicalHash: string
        googleHash: string
        lastReconciledAt: string | null
      }>
      googleDetails: {
        primaryCategory: string | null
        additionalCategories: string[]
      }
      latestAttempt: {
        id: string
        direction: string
        status: string
        selectedFields: string[]
        createdAt: string
        finishedAt: string | null
      } | null
}

export async function loadLocationProfile(locationId: string) {
  return apiFetch<{ profile: ProfileViewState }>(
    `/api/locations/${locationId}/profile`
  )
}

export async function saveLocationProfile(
  locationId: string,
  input: {
    expectedCanonicalRevision: string
    values: Partial<Record<"name" | "description" | "phone" | "website", string | null>>
  }
) {
  return apiFetch<{ saved: true; revision: string }>(
    `/api/locations/${locationId}/profile`,
    { method: "PUT", body: JSON.stringify(input) }
  )
}

export async function syncLocationProfile(
  locationId: string,
  input: {
    direction: "to_google" | "from_google"
    selectedFields: ProfileFieldKey[]
    expectedCanonicalRevision: string
    expectedCanonicalHash: string
    expectedGoogleHash: string
    confirmOverwriteGoogleChanges: boolean
    confirmOverwriteCanonicalChanges: boolean
  }
) {
  return apiFetch<{
    status: "published" | "imported"
    attemptId?: string
    revision?: string
    idempotent: boolean
  }>(`/api/locations/${locationId}/profile`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      confirmation:
        input.direction === "to_google"
          ? "publish_nabapresence_profile_to_google"
          : "import_google_profile_to_nabapresence",
    }),
  })
}

export type PlaceActionType =
  | "APPOINTMENT"
  | "ONLINE_APPOINTMENT"
  | "DINING_RESERVATION"
  | "FOOD_ORDERING"
  | "FOOD_DELIVERY"
  | "FOOD_TAKEOUT"
  | "SHOP_ONLINE"

export type PlaceActionState = {
  locationId: string
  canPublish: boolean
  writesEnabled: boolean
  supportedTypes: PlaceActionType[]
  links: Array<{
    id: string
    googleLinkName: string
    providerType: string
    isEditable: boolean
    uri: string
    placeActionType: PlaceActionType
    isPreferred: boolean
    googleHash: string
    observedAt: string
  }>
  latestMutation: {
    id: string
    operation: string
    status: string
    createdAt: string
    finishedAt: string | null
  } | null
}

export type PlaceActionInput = {
  uri: string
  placeActionType: PlaceActionType
  isPreferred: boolean
}

export async function loadPlaceActions(locationId: string) {
  return apiFetch<{ placeActions: PlaceActionState }>(
    `/api/locations/${locationId}/place-actions`
  )
}

export async function createPlaceActionLink(
  locationId: string,
  input: PlaceActionInput
) {
  return apiFetch(`/api/locations/${locationId}/place-actions`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      confirmation: "create_google_place_action",
    }),
  })
}

export async function updatePlaceActionLink(
  locationId: string,
  linkId: string,
  input: PlaceActionInput & { expectedGoogleHash: string }
) {
  return apiFetch(`/api/locations/${locationId}/place-actions/${linkId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...input,
      confirmation: "update_google_place_action",
    }),
  })
}

export async function deletePlaceActionLink(
  locationId: string,
  linkId: string,
  expectedGoogleHash: string
) {
  return apiFetch(`/api/locations/${locationId}/place-actions/${linkId}`, {
    method: "DELETE",
    body: JSON.stringify({
      expectedGoogleHash,
      confirmation: "delete_google_place_action",
    }),
  })
}

export type MediaCategory =
  | "COVER" | "PROFILE" | "LOGO" | "EXTERIOR" | "INTERIOR"
  | "PRODUCT" | "AT_WORK" | "FOOD_AND_DRINK" | "MENU"
  | "COMMON_AREA" | "ROOMS" | "TEAMS" | "ADDITIONAL"

export type MediaState = {
  canPublish: boolean
  writesEnabled: boolean
  categories: MediaCategory[]
  items: Array<{
    id: string
    googleMediaName: string
    ownership: "merchant" | "customer"
    mediaFormat: "PHOTO" | "VIDEO"
    category: MediaCategory | null
    sourceUrl: string | null
    googleUrl: string | null
    thumbnailUrl: string | null
    description: string | null
    attribution: { profileName?: string; profilePhotoUrl?: string; takedownUrl?: string; profileUrl?: string } | null
    dimensions: { widthPixels?: number; heightPixels?: number } | null
    insights: { viewCount?: string } | null
    googleHash: string
    createTime: string | null
  }>
}

export async function loadLocationMedia(locationId: string) {
  return apiFetch<{ media: MediaState }>(`/api/locations/${locationId}/media`)
}

export async function createLocationMedia(locationId: string, input: {
  mediaFormat: "PHOTO" | "VIDEO"
  category: MediaCategory
  sourceUrl: string
  description?: string
}) {
  return apiFetch(`/api/locations/${locationId}/media`, { method: "POST", body: JSON.stringify({ ...input, confirmation: "create_google_media" }) })
}

export async function uploadLocationMedia(
  locationId: string,
  input: {
    mediaFormat: "PHOTO" | "VIDEO"
    category: MediaCategory
    file: File
    description?: string
  }
) {
  const form = new FormData()
  form.set("mediaFormat", input.mediaFormat)
  form.set("category", input.category)
  form.set("file", input.file)
  form.set("confirmation", "create_google_media")
  if (input.description) form.set("description", input.description)
  return apiFetch(`/api/locations/${locationId}/media`, {
    method: "POST",
    body: form,
  })
}

export async function updateLocationMedia(locationId: string, mediaId: string, category: MediaCategory, expectedGoogleHash: string) {
  return apiFetch(`/api/locations/${locationId}/media/${mediaId}`, { method: "PATCH", body: JSON.stringify({ category, expectedGoogleHash, confirmation: "update_google_media" }) })
}

export async function deleteLocationMedia(locationId: string, mediaId: string, expectedGoogleHash: string) {
  return apiFetch(`/api/locations/${locationId}/media/${mediaId}`, { method: "DELETE", body: JSON.stringify({ expectedGoogleHash, confirmation: "delete_google_media" }) })
}

export type BusinessInformationState = {
  location: Record<string, unknown>
  attributes: {
    name?: string
    attributes?: Array<Record<string, unknown>>
  }
  attributeMetadata: Array<Record<string, unknown>>
  locationHash: string
  attributesHash: string
  canPublish: boolean
  writesEnabled: boolean
}

export async function loadBusinessInformation(locationId: string) {
  return apiFetch<{ businessInformation: BusinessInformationState }>(
    `/api/locations/${locationId}/business-information`
  )
}

export async function updateBusinessInformation(
  locationId: string,
  input: {
    expectedGoogleHash: string
    updateMask: string[]
    payload: Record<string, unknown>
  }
) {
  return apiFetch(`/api/locations/${locationId}/business-information`, {
    method: "PATCH",
    body: JSON.stringify({
      operation: "update_location",
      confirmation: "publish_business_information_to_google",
      ...input,
    }),
  })
}

export async function updateBusinessAttributes(
  locationId: string,
  input: {
    expectedGoogleHash: string
    attributeMask: string[]
    attributes: Array<Record<string, unknown>>
  }
) {
  return apiFetch(`/api/locations/${locationId}/business-information`, {
    method: "PATCH",
    body: JSON.stringify({
      operation: "update_attributes",
      confirmation: "publish_business_attributes_to_google",
      ...input,
    }),
  })
}

export async function searchBusinessInformationMetadata(
  locationId: string,
  input: {
    type: "categories" | "chains"
    query: string
    regionCode?: string
    languageCode?: string
  }
) {
  const params = new URLSearchParams({
    type: input.type,
    query: input.query,
    regionCode: input.regionCode ?? "GB",
    languageCode: input.languageCode ?? "en",
  })
  return apiFetch<{ result: Record<string, unknown> }>(
    `/api/locations/${locationId}/business-information?${params}`
  )
}

export type LocationAdministrationState = {
  voice: { data: Record<string, unknown> | null; error: string | null }
  verifications: { data: Record<string, unknown> | null; error: string | null }
  verificationOptions: { data: Record<string, unknown> | null; error: string | null }
  googleUpdated: { data: Record<string, unknown> | null; error: string | null }
  locationAdmins: { data: Record<string, unknown> | null; error: string | null }
  accountAdmins: { data: Record<string, unknown> | null; error: string | null }
  invitations: { data: Record<string, unknown> | null; error: string | null }
  accountName: string
  googleLocationName: string
  canManage: boolean
  writesEnabled: boolean
}

export type LocationAdministrationOperation =
  | "start_verification" | "complete_verification" | "create_admin"
  | "update_admin" | "delete_admin" | "accept_invitation"
  | "decline_invitation" | "transfer_location" | "create_location"
  | "delete_location" | "accept_google_update"

export async function loadLocationAdministration(locationId: string) {
  return apiFetch<{ administration: LocationAdministrationState }>(
    `/api/locations/${locationId}/administration`
  )
}

const ADMINISTRATION_CONFIRMATIONS: Record<
  LocationAdministrationOperation,
  string
> = {
  start_verification: "start_google_location_verification",
  complete_verification: "complete_google_location_verification",
  create_admin: "invite_google_administrator",
  update_admin: "change_google_administrator_role",
  delete_admin: "remove_google_administrator",
  accept_invitation: "accept_google_invitation",
  decline_invitation: "decline_google_invitation",
  transfer_location: "transfer_google_location",
  create_location: "create_google_location",
  delete_location: "delete_google_location_permanently",
  accept_google_update: "accept_google_suggested_update",
}

export async function mutateLocationAdministration(
  locationId: string,
  operation: LocationAdministrationOperation,
  payload: Record<string, unknown>
) {
  return apiFetch(`/api/locations/${locationId}/administration`, {
    method: "PATCH",
    body: JSON.stringify({
      operation,
      confirmation: ADMINISTRATION_CONFIRMATIONS[operation],
      payload,
    }),
  })
}

export async function matchGoogleLocation(
  locationId: string,
  location: Record<string, unknown>
) {
  return apiFetch<{ matches: Record<string, unknown> }>(
    `/api/locations/${locationId}/administration`,
    {
      method: "POST",
      body: JSON.stringify({ operation: "match_location", location }),
    }
  )
}

type GoogleSurfaceResult = {
  data: Record<string, unknown> | null
  error: string | null
}

export type IndustryManagementState = {
  lodging: GoogleSurfaceResult
  lodgingUpdated: GoogleSurfaceResult
  calls: GoogleSurfaceResult
  callInsights: GoogleSurfaceResult
  healthcareServices: GoogleSurfaceResult
  providerAttributes: GoogleSurfaceResult
  insuranceNetworks: GoogleSurfaceResult
  canManage: boolean
  writesEnabled: boolean
}

export type IndustryOperation =
  | "update_lodging"
  | "update_business_calls"
  | "update_healthcare_services"
  | "update_healthcare_provider_attributes"

export async function loadIndustryManagement(locationId: string) {
  return apiFetch<{ industry: IndustryManagementState }>(
    `/api/locations/${locationId}/industry`
  )
}

export async function updateIndustryManagement(
  locationId: string,
  input: {
    operation: IndustryOperation
    updateMask: string[]
    payload: Record<string, unknown>
  }
) {
  return apiFetch(`/api/locations/${locationId}/industry`, {
    method: "PATCH",
    body: JSON.stringify({
      ...input,
      confirmation: "publish_industry_data_to_google",
    }),
  })
}

export type FoodMenuLabel = {
  displayName: string
  description?: string
  languageCode: string
}

export type FoodMenuItem = {
  labels: FoodMenuLabel[]
  attributes: {
    price?: { currencyCode: string; units?: string | number; nanos?: number }
    dietaryRestriction?: string[]
    allergen?: string[]
  }
  options?: Array<{ labels: FoodMenuLabel[]; attributes: Record<string, unknown> }>
}

export type FoodMenu = {
  labels: FoodMenuLabel[]
  sourceUrl?: string
  cuisines?: string[]
  sections: Array<{ labels: FoodMenuLabel[]; items: FoodMenuItem[] }>
}

export type FoodMenusViewState = {
      location: { id: string; name: string; googleLocationName: string }
      canonicalResource: {
        revision: string
        updatedAt: string
      }
      eligible: boolean
      status: "in_sync" | "drift"
      canonicalMenus: FoodMenu[]
      googleMenus: FoodMenu[]
      canonicalHash: string
      googleHash: string
      canonicalCounts: { menus: number; sections: number; items: number; options: number }
      googleCounts: { menus: number; sections: number; items: number; options: number }
      canPublish: boolean
      writesEnabled: boolean
}

export async function loadLocationFoodMenus(locationId: string) {
  return apiFetch<{ foodMenus: FoodMenusViewState }>(
    `/api/locations/${locationId}/food-menus`
  )
}

export async function saveLocationFoodMenus(
  locationId: string,
  input: { expectedCanonicalRevision: string; menus: FoodMenu[] }
) {
  return apiFetch<{ saved: true; revision: string }>(
    `/api/locations/${locationId}/food-menus`,
    { method: "PUT", body: JSON.stringify(input) }
  )
}

export async function publishLocationFoodMenus(
  locationId: string,
  input: {
    expectedCanonicalRevision: string
    expectedCanonicalHash: string
    expectedGoogleHash: string
  }
) {
  return apiFetch<{ status: "published" | "in_sync"; attemptId?: string; idempotent: boolean }>(
    `/api/locations/${locationId}/food-menus`,
    {
      method: "POST",
      body: JSON.stringify({
        confirmation: "publish_nabapresence_food_menus_to_google",
        confirmFullReplacement: true,
        ...input,
      }),
    }
  )
}

export async function signOut(): Promise<void> {
  await apiFetch("/api/session", { method: "DELETE" })
}

export async function signInWithEmailPassword(input: {
  email: string
  password: string
  inviteToken?: string
}) {
  return apiFetch<{ authenticated: true }>("/api/auth/password/login", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function registerWithEmailPassword(input: {
  displayName: string
  email: string
  password: string
  inviteToken?: string
}) {
  return apiFetch<{
    authenticated: boolean
    confirmationRequired?: boolean
  }>("/api/auth/password/register", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function requestPasswordReset(email: string) {
  return apiFetch<{ accepted: true; message: string }>(
    "/api/auth/password/reset/request",
    {
      method: "POST",
      body: JSON.stringify({ email }),
    }
  )
}

export async function completePasswordReset(
  tokenHash: string,
  password: string
) {
  return apiFetch<{ updated: true; authenticated: true }>(
    "/api/auth/password/reset/complete",
    {
      method: "POST",
      body: JSON.stringify({ tokenHash, password }),
    }
  )
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

export type ReviewCounts = {
  total: number
  byStatus: Record<ReviewWorkflowState, number>
}

export async function loadReviewCounts(
  locationId?: string
): Promise<ReviewCounts> {
  await requireApiSession()
  const params = new URLSearchParams()
  if (locationId) params.set("locationId", locationId)
  const query = params.size ? `?${params.toString()}` : ""
  return apiFetch<ReviewCounts>(`/api/reviews/counts${query}`)
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
  tone: DraftTone = "warm_professional",
  languageOverride?: string | null
) {
  const result = await apiFetch<{
    draftId: string
    body: string
    verification: { verdict: VerificationStatus }
  }>(`/api/reviews/${reviewId}/drafts`, {
    method: "POST",
    body: JSON.stringify({ tone, languageOverride }),
  })
  return result
}

export async function saveDraft(
  reviewId: string,
  body: string,
  tone: DraftTone = "warm_professional",
  languageOverride?: string | null
) {
  return apiFetch<{
    draftId: string
    body: string
    verification: { verdict: VerificationStatus }
  }>(`/api/reviews/${reviewId}/drafts`, {
    method: "POST",
    body: JSON.stringify({ tone, body, languageOverride }),
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

export async function approveReply(reviewId: string) {
  return apiFetch<{
    status: "published" | "rejected" | "pending"
    googleReplyState: "PENDING" | "APPROVED" | "REJECTED" | null
  }>(`/api/reviews/${reviewId}/approval`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve" }),
  })
}

export async function rejectReply(reviewId: string, note?: string) {
  return apiFetch<{ status: "returned_to_draft" }>(
    `/api/reviews/${reviewId}/approval`,
    {
      method: "POST",
      body: JSON.stringify({ decision: "reject", note }),
    }
  )
}

export async function deleteReply(reviewId: string) {
  return apiFetch<{
    status: "remote_deleted" | "local_cancelled"
    publishAttemptId: string
  }>(`/api/reviews/${reviewId}/reply`, { method: "DELETE" })
}

export type GoogleConnection = {
  id: string
  googleEmail: string | null
  status: string
  scope?: string
  notificationsEnabled: boolean
  lastRefreshAt: string | null
  lastErrorCode: string | null
  reconnectRequired: boolean
  createdAt: string
}

export type GoogleLocation = {
  id: string
  accountName: string
  googleLocationName: string
  title: string
  address: string
  verified: boolean
}

export type StorefrontAddress = {
  addressLines?: string[]
  locality?: string
  administrativeArea?: string
  postalCode?: string
  regionCode?: string
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
    body: JSON.stringify({}),
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
      name: options.locationId ? undefined : location.title,
      timezone: "Europe/London",
      confirmRelink: options.confirmRelink ?? false,
    }),
  })
}

export async function unlinkLocation(externalLocationId: string) {
  const params = new URLSearchParams({ externalLocationId })
  return apiFetch<{ unlinked: true }>(
    `/api/location-links?${params.toString()}`,
    { method: "DELETE" }
  )
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

export type GoogleNotificationType =
  | "GOOGLE_UPDATE"
  | "NEW_REVIEW"
  | "UPDATED_REVIEW"
  | "NEW_CUSTOMER_MEDIA"
  | "DUPLICATE_LOCATION"
  | "VOICE_OF_MERCHANT_UPDATED"

export async function configureGoogleNotifications(
  accountId: string,
  pubsubTopic: string,
  notificationTypes: GoogleNotificationType[]
) {
  return apiFetch("/api/google/notifications", {
    method: "PATCH",
    body: JSON.stringify({ accountId, pubsubTopic, notificationTypes }),
  })
}

export type OrganisationSettings = {
  approvalRequired: boolean
  requireTwoPersonApproval?: boolean
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

export type Invitation = {
  id: string
  email: string
  role: OrganisationMember["role"]
  canPublish: boolean
  expiresAt: string
  acceptedAt?: string | null
  createdAt: string
  inviteUrl: string
}

export async function loadInvitations() {
  await requireApiSession()
  return apiFetch<{ items: Invitation[] }>("/api/invitations")
}

export async function createInvitation(input: {
  email: string
  role: OrganisationMember["role"]
  canPublish: boolean
}) {
  return apiFetch<{ invitation: Invitation; inviteUrl: string }>(
    "/api/invitations",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  )
}

export async function lookupInvitation(token: string) {
  return apiFetch<{
    organisationName: string
    email: string
    expired: boolean
  }>(`/api/invitations/${encodeURIComponent(token)}`)
}

export type OrganisationMembership = {
  organisationId: string
  name: string
  role: OrganisationMember["role"]
}

export async function loadOrganisations() {
  return apiFetch<{ items: OrganisationMembership[] }>("/api/organisations")
}

export async function switchOrganisation(organisationId: string) {
  return apiFetch<{ session: AppSession }>("/api/session/switch", {
    method: "POST",
    body: JSON.stringify({ organisationId }),
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
  address: StorefrontAddress | null
  linkId: string | null
  externalLocationId: string | null
  googleLocationName: string | null
  googleTitle: string | null
  verified: boolean | null
}

export type LocationDirectoryItem = {
  id: string
  name: string
  googleLocationName?: string | null
}

export async function loadLocations() {
  await requireApiSession()
  return apiFetch<{ locations: LocationDirectoryItem[] }>(
    "/api/location-links"
  )
}

export async function loadInternalLocations() {
  await requireApiSession()
  return apiFetch<{ locations: InternalLocation[] }>(
    "/api/location-links?view=management"
  )
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
  timezone: string
  summary: {
    reviewVolume: number
    averageRating: number | null
    responseRate: number | null
    unresolvedComplaints: number
    verificationFailures: number
    verificationRejectionRate: number | null
    medianFirstResponseSeconds: number | null
    p95FirstResponseSeconds: number | null
    medianLatestEditSeconds: number | null
  }
  series: Array<{
    period: string
    reviewCount: number
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
    medianFirstResponseSeconds: number | null
    p95FirstResponseSeconds: number | null
    medianLatestEditSeconds: number | null
    unresolvedComplaints: number
    verificationRejectionRate: number | null
  }>
  providerTotals: {
    averageRating: number | null
    totalReviewCount: number | null
    localReviewCount: number
    divergence: boolean
  }
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

export type PresenceMetric =
  | "BUSINESS_IMPRESSIONS_DESKTOP_MAPS"
  | "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH"
  | "BUSINESS_IMPRESSIONS_MOBILE_MAPS"
  | "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"
  | "CALL_CLICKS"
  | "WEBSITE_CLICKS"
  | "BUSINESS_DIRECTION_REQUESTS"
  | "BUSINESS_CONVERSATIONS"
  | "BUSINESS_BOOKINGS"
  | "BUSINESS_FOOD_ORDERS"
  | "BUSINESS_FOOD_MENU_CLICKS"

export type PresenceAnalytics = {
  range: "28d" | "90d" | "12m" | "18m"
  from: string
  to: string
  state: "no_link" | "pending" | "unavailable" | "empty" | "ready"
  freshThrough: string | null
  locations: Array<{ id: string; name: string }>
  totals: Record<PresenceMetric, number>
  series: Array<{
    date: string
    metrics: Partial<Record<PresenceMetric, number>>
  }>
  unavailableReasons: string[]
  keywordsEnabled: boolean
  ingestionEnabled: boolean
}

export async function loadPresenceAnalytics(options?: {
  range?: PresenceAnalytics["range"]
  locationId?: string
}) {
  await requireApiSession()
  const params = new URLSearchParams()
  if (options?.range) params.set("range", options.range)
  if (options?.locationId) params.set("locationId", options.locationId)
  const query = params.size ? `?${params}` : ""
  return apiFetch<PresenceAnalytics>(`/api/analytics/presence${query}`)
}

export type PresenceKeywordAnalytics = {
  range: "1m" | "6m" | "12m" | "18m"
  from: string
  state: "no_link" | "pending" | "unavailable" | "empty" | "ready"
  locations: Array<{ id: string; name: string }>
  keywords: Array<{
    rank: number
    keyword: string
    impressions: number
    upperBound: number
    thresholded: boolean
    firstMonth: string
    latestMonth: string
  }>
  unavailableReasons: string[]
}

export async function loadPresenceKeywords(options?: {
  range?: PresenceKeywordAnalytics["range"]
  locationId?: string
}) {
  await requireApiSession()
  const params = new URLSearchParams()
  if (options?.range) params.set("range", options.range)
  if (options?.locationId) params.set("locationId", options.locationId)
  const query = params.size ? `?${params}` : ""
  return apiFetch<PresenceKeywordAnalytics>(
    `/api/analytics/presence/keywords${query}`
  )
}

export type LocalPost = {
  id: string
  topicType: "STANDARD" | "EVENT" | "OFFER"
  languageCode: string
  summary: string
  callToAction: { actionType: string; url?: string } | null
  event: Record<string, unknown> | null
  offer: Record<string, unknown> | null
  media: Array<{ sourceUrl?: string }>
  scheduledTime: string | null
  status: "draft" | "awaiting_approval" | "publishing" | "published" | "failed" | "ambiguous"
  googlePostName: string | null
  googleState: string | null
  googleSearchUrl: string | null
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}

export type LocalPostInput = {
  topicType: LocalPost["topicType"]
  languageCode: string
  summary: string
  callToAction?: { actionType: string; url?: string }
  event?: Record<string, unknown>
  offer?: {
    couponCode?: string
    redeemOnlineUrl?: string
    termsConditions?: string
  }
  media: Array<{ sourceUrl: string }>
  scheduledTime?: string
}

export async function loadLocalPosts(locationId: string) {
  return apiFetch<{
    posts: LocalPost[]
    writesEnabled: boolean
    reconciliationError: string | null
  }>(`/api/locations/${locationId}/posts`)
}

export async function saveLocalPost(
  locationId: string,
  input: LocalPostInput,
  postId?: string
) {
  return apiFetch(`/api/locations/${locationId}/posts${postId ? `/${postId}` : ""}`, {
    method: postId ? "PATCH" : "POST",
    body: JSON.stringify(input),
  })
}

export async function publishLocalPost(locationId: string, postId: string) {
  return apiFetch<{ status: string }>(
    `/api/locations/${locationId}/posts/${postId}/publish`,
    { method: "POST", body: JSON.stringify({}) }
  )
}

export async function decideLocalPost(
  locationId: string,
  postId: string,
  decision: "approve" | "reject"
) {
  return apiFetch<{ status: string }>(
    `/api/locations/${locationId}/posts/${postId}/approval`,
    { method: "POST", body: JSON.stringify({ decision }) }
  )
}

export async function removeLocalPost(locationId: string, postId: string) {
  return apiFetch<{ status: string }>(
    `/api/locations/${locationId}/posts/${postId}`,
    { method: "DELETE" }
  )
}
