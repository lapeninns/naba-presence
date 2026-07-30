export type ReviewStatus =
  "needs_reply" | "awaiting_approval" | "published" | "escalated"

export type VerificationStatus = "pass" | "warn" | "fail" | "pending"

export type Review = {
  id: string
  reviewer: string
  initials: string
  rating: number | null
  location: string
  locationId?: string
  excerpt: string
  text: string
  postedAt: string
  updatedAt: string
  language: string
  status: ReviewStatus
  verification: VerificationStatus
  draft: string
  publishedReply?: string
  draftId?: string
  sourceUpdateTime?: string
  sourceCreateTime?: string
  replyStatus?: string
  syncStatus?: string
  responseTime?: string
  googleState?: "APPROVED" | "PENDING" | "REJECTED"
}
