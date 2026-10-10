import "server-only"

import { randomUUID } from "node:crypto"
import type { TransactionSql } from "postgres"
import type { z } from "zod"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { googleOnboardingDraftSchema, type GoogleOnboardingDraft, type googleOnboardingDraftCreateSchema, type googleOnboardingDraftSaveSchema } from "@/lib/contracts/google-onboarding"
import { writeAudit } from "./audit"
import { jsonColumn, withTenant } from "./db"
import { stableGoogleHash } from "./gbp-management"
import { resolveOnboardingAccountInTransaction, searchOnboardingMatches } from "./google-onboarding"
import { ApiError } from "./http"
import type { Session } from "./session"

type DraftRow = {
  id: string; google_account_id: string; account_name: string; connection_id: string;
  client_id: string | null; requested_by: string; provider_request_id: string;
  revision: number; payload: GoogleOnboardingDraft["payload"]; payload_hash: string;
  match_result: GoogleOnboardingDraft["matchResult"];
  match_request_id: string | null;
  created_at: Date; updated_at: Date; expires_at: Date;
}

function project(row: DraftRow): GoogleOnboardingDraft {
  return googleOnboardingDraftSchema.parse({
    id: row.id, accountId: row.google_account_id, accountName: row.account_name,
    connectionId: row.connection_id, clientId: row.client_id, requestedBy: row.requested_by,
    providerRequestId: row.provider_request_id, revision: row.revision,
    payload: row.payload, payloadHash: row.payload_hash, matchResult: row.match_result,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), expiresAt: row.expires_at.toISOString(),
  })
}

export async function checkedOnboardingDraft(sql: TransactionSql, session: Session, accountId: string, draftId: string) {
  const [row] = await sql<DraftRow[]>`select * from google_onboarding_draft where id = ${draftId} and google_account_id = ${accountId} and expires_at > now() for update`
  if (!row) throw new ApiError(404, "onboarding_draft_not_found", "This onboarding draft was not found or expired.")
  const account = await resolveOnboardingAccountInTransaction(sql, session, { accountId, connectionId: row.connection_id, clientId: row.client_id ?? undefined })
  if (account.name !== row.account_name) throw new ApiError(409, "onboarding_account_changed", "The selected Google account changed. Start a new draft after refreshing account discovery.")
  return row
}

export async function createOnboardingDraft(session: Session, accountId: string, input: z.infer<typeof googleOnboardingDraftCreateSchema>, requestId: string) {
  return withTenant(session.organisationId, async (sql) => {
    const account = await resolveOnboardingAccountInTransaction(sql, session, { accountId, connectionId: input.connectionId, clientId: input.clientId })
    const hash = stableGoogleHash(input.payload)
    const inserted = await sql<DraftRow[]>`
      insert into google_onboarding_draft (id, organisation_id, google_account_id, account_name, connection_id, client_id, requested_by, payload, payload_hash)
      values (${input.draftId}, ${session.organisationId}, ${accountId}, ${account.name}, ${input.connectionId}, ${input.clientId ?? null}, ${session.userId}, ${jsonColumn(sql, input.payload)}, ${hash})
      on conflict (id) do nothing returning *
    `
    const row = inserted[0] ?? await checkedOnboardingDraft(sql, session, accountId, input.draftId)
    if (row.revision !== 1 || row.payload_hash !== hash || row.connection_id !== input.connectionId || row.client_id !== (input.clientId ?? null) || row.requested_by !== session.userId) {
      throw new ApiError(409, "onboarding_draft_conflict", "This draft already exists with different details. Restore it before editing.")
    }
    if (inserted.length) await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.draft_created", subjectType: "google_onboarding_draft", subjectId: row.id, requestId, metadata: { accountId, payloadHash: hash } })
    return project(row)
  })
}

export async function getOnboardingDraft(session: Session, accountId: string, draftId: string) {
  return withTenant(session.organisationId, async (sql) => project(await checkedOnboardingDraft(sql, session, accountId, draftId)))
}

export async function listOnboardingDrafts(session: Session, accountId: string, input: { connectionId: string; clientId?: string }) {
  return withTenant(session.organisationId, async (sql) => {
    await resolveOnboardingAccountInTransaction(sql, session, { accountId, ...input })
    const rows = await sql<DraftRow[]>`select * from google_onboarding_draft where google_account_id = ${accountId} and connection_id = ${input.connectionId} and client_id is not distinct from ${input.clientId ?? null}::uuid and expires_at > now() order by updated_at desc, id desc limit 20`
    return { drafts: rows.map(project) }
  })
}

export async function requireNoOnboardingMatchLink(sql: TransactionSql, draftId: string, allowedReviewId?: string) {
  const [link] = await sql<{ review_id: string }[]>`select review_id from google_onboarding_match_link where draft_id = ${draftId} and state in ('pending', 'linked')`
  if (link && link.review_id !== allowedReviewId) throw new ApiError(409, "onboarding_match_link_started", "An existing match is being linked or was linked. Restore that operation instead of creating another listing.")
}

export async function requireEditableOnboardingDraft(sql: TransactionSql, draftId: string, allowedMatchLinkReviewId?: string) {
  const [creation] = await sql`select id from google_onboarding_creation where draft_id = ${draftId}`
  if (creation) throw new ApiError(409, "onboarding_creation_started", "Creation has already started. Recover the existing operation instead of changing its draft.")
  await requireNoOnboardingMatchLink(sql, draftId, allowedMatchLinkReviewId)
}

export async function saveOnboardingDraft(session: Session, accountId: string, draftId: string, input: z.infer<typeof googleOnboardingDraftSaveSchema>, requestId: string) {
  return withTenant(session.organisationId, async (sql) => {
    const row = await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireEditableOnboardingDraft(sql, draftId)
    if (row.revision !== input.expectedRevision) throw new ApiError(409, "onboarding_draft_stale", "This draft changed. Restore the latest version before saving.")
    const hash = stableGoogleHash(input.payload)
    if (hash === row.payload_hash) return project(row)
    const [saved] = await sql<DraftRow[]>`update google_onboarding_draft set payload = ${jsonColumn(sql, input.payload)}, payload_hash = ${hash}, revision = revision + 1, match_result = null, updated_at = now() where id = ${row.id} returning *`
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.draft_saved", subjectType: "google_onboarding_draft", subjectId: row.id, requestId, metadata: { revision: saved.revision, payloadHash: hash } })
    return project(saved)
  })
}

export async function matchOnboardingDraft(session: Session, accountId: string, draftId: string, expectedRevision: number, requestId: string) {
  const matchRequestId = randomUUID()
  const draft = await withTenant(session.organisationId, async (sql) => {
    const row = await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireEditableOnboardingDraft(sql, draftId)
    if (row.revision !== expectedRevision) throw new ApiError(409, "onboarding_draft_stale", "Restore the latest draft before matching.")
    if (!row.payload.title) throw new ApiError(422, "onboarding_name_required", "Enter the business name before searching for matches.")
    await sql`update google_onboarding_draft set match_result = null, match_request_id = ${matchRequestId}, updated_at = now() where id = ${draftId}`
    return project(row)
  })
  const location = businessInformationPayloadSchema.strip().parse(draft.payload)
  const result = await searchOnboardingMatches(session, accountId, { connectionId: draft.connectionId, clientId: draft.clientId ?? undefined, pageSize: 10, search: { kind: "location", location } })
  return withTenant(session.organisationId, async (sql) => {
    const row = await checkedOnboardingDraft(sql, session, accountId, draftId)
    if (row.revision !== expectedRevision) throw new ApiError(409, "onboarding_draft_stale", "The draft changed during matching. Search again using its latest details.")
    await requireEditableOnboardingDraft(sql, draftId)
    if (row.match_request_id !== matchRequestId) throw new ApiError(409, "onboarding_match_superseded", "A newer search started for this draft. Refresh to see its result.")
    const [saved] = await sql<DraftRow[]>`update google_onboarding_draft set match_result = ${jsonColumn(sql, result)}, updated_at = now() where id = ${draftId} returning *`
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.matched", subjectType: "google_onboarding_draft", subjectId: draftId, requestId, metadata: { revision: row.revision, matchCount: result.matches.length } })
    return project(saved)
  })
}
