import { z } from "zod"

export const OPERATIONAL_EVENT_POLICY = {
  publication_failed: { incident: "publication_failed", email: "immediate", resolves: null },
  publication_unresolved: { incident: "publication_unresolved", email: "digest", resolves: null },
  publication_confirmed: { incident: null, email: "none", resolves: "publication_unresolved" },
  schedule_missed: { incident: "schedule_missed", email: "immediate", resolves: null },
  schedule_blocked: { incident: "schedule_blocked", email: "digest", resolves: null },
  bulk_completed_with_failures: { incident: "bulk_completed_with_failures", email: "digest", resolves: null },
  verification_changed: { incident: "verification_changed", email: "digest", resolves: null },
  suggestions_available: { incident: "suggestions_available", email: "digest", resolves: null },
  resource_stale: { incident: "resource_stale", email: "digest", resolves: null },
  resource_recovered: { incident: null, email: "none", resolves: "resource_stale" },
} as const

const resourceSchema = z.enum([
  "reviews", "profile", "hours", "attributes", "media", "posts", "menus",
  "links", "administration", "lodging", "services", "performance", "keywords",
])
const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("location"), locationId: z.uuid() }).strict(),
  z.object({ type: z.literal("account"), accountId: z.uuid() }).strict(),
  // Organisation-wide outcomes (a bulk change spanning many listings): owners and admins only.
  z.object({ type: z.literal("organisation") }).strict(),
])
const base = {
  version: z.literal(1),
  organisationId: z.uuid(),
  target: targetSchema,
  occurredAt: z.iso.datetime({ offset: true }),
}
const attempt = {
  ...base,
  source: z.object({ type: z.literal("attempt"), family: resourceSchema, id: z.uuid() }).strict(),
}
const schedule = {
  ...base,
  source: z.object({ type: z.literal("schedule_occurrence"), id: z.uuid(), scheduleId: z.uuid() }).strict(),
}
const resource = {
  ...base,
  source: z.object({ type: z.literal("resource"), family: resourceSchema }).strict(),
}

export const operationalEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...attempt, kind: z.literal("publication_failed"), reason: z.enum(["provider_rejected", "permission_revoked", "approval_invalid", "expired_content", "retries_exhausted"]) }).strict(),
  z.object({ ...attempt, kind: z.literal("publication_unresolved"), reason: z.enum(["response_ambiguous", "readback_failed", "readback_mismatch", "execution_interrupted"]) }).strict(),
  z.object({ ...attempt, kind: z.literal("publication_confirmed") }).strict(),
  z.object({ ...schedule, kind: z.literal("schedule_missed"), dueAt: z.iso.datetime({ offset: true }), reason: z.enum(["outside_grace_period", "expired_content"]) }).strict(),
  z.object({ ...schedule, kind: z.literal("schedule_blocked"), reason: z.enum(["approval_invalid", "permission_revoked", "connection_unavailable", "publishing_paused", "prior_occurrence_unresolved"]) }).strict(),
  z.object({ ...base, kind: z.literal("bulk_completed_with_failures"), source: z.object({ type: z.literal("bulk"), id: z.uuid() }).strict(), succeeded: z.number().int().min(0).max(100), failed: z.number().int().min(1).max(100), skipped: z.number().int().min(0).max(100) }).strict().refine((event) => event.succeeded + event.failed + event.skipped <= 100, "A batch cannot exceed 100 targets."),
  z.object({ ...base, kind: z.literal("verification_changed"), source: z.object({ type: z.literal("verification"), id: z.uuid() }).strict(), state: z.enum(["pending", "completed", "failed", "expired", "external_action_required"]) }).strict(),
  z.object({ ...resource, kind: z.literal("suggestions_available"), observationId: z.uuid() }).strict(),
  z.object({ ...resource, kind: z.literal("resource_stale"), lastSuccessfulFetchAt: z.iso.datetime({ offset: true }).nullable() }).strict(),
  z.object({ ...resource, kind: z.literal("resource_recovered"), lastSuccessfulFetchAt: z.iso.datetime({ offset: true }) }).strict(),
])

export type OperationalEvent = z.infer<typeof operationalEventSchema>

/** Incident identity stays stable between an unresolved event and its recovery. */
export function operationalSubjectKey(event: OperationalEvent): string {
  const target = event.target.type === "location" ? `location:${event.target.locationId}`
    : event.target.type === "account" ? `account:${event.target.accountId}` : "organisation"
  const source = event.source.type === "resource"
    ? `resource:${event.source.family}`
    : event.source.type === "attempt"
      ? `attempt:${event.source.family}:${event.source.id}`
      : `${event.source.type}:${event.source.id}`
  return `${event.organisationId}:${target}:${source}`
}

/** Optional email categories remain opt-in until recipient preferences exist. */
export function operationalEmailMode(event: OperationalEvent, explicitlyEnabled: boolean) {
  return explicitlyEnabled ? OPERATIONAL_EVENT_POLICY[event.kind].email : "none"
}
