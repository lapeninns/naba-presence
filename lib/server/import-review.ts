import "server-only"

import { randomUUID } from "node:crypto"

import type { TransactionSql } from "postgres"

import {
  applyFoodMenuPatch,
  buildFoodMenuProposals,
  identitiesFromAlignedMenus,
  locateMenuItem,
  menuItemSummary,
  MenuPatchTargetMissingError,
  type MenuItemIdentity,
  type MenuProposalDraft,
} from "@/lib/domain/food-menu-import"
import { hashFoodMenus } from "@/lib/domain/food-menus"
import type {
  ImportProposal,
  ImportReviewCounts,
  PendingProposalCount,
  RaiseOutcome,
  RaiseTrigger,
} from "@/lib/contracts/location-import-review"
import {
  classifyResourceDrift,
  planDecision,
  ProposalDecisionError,
  type ProposalDecisionAction,
  type ProposalKind,
  type ProposalResourceType,
  type ProposalStatus,
} from "@/lib/domain/import-review"
import { hashProfileValue } from "@/lib/domain/profile"
import {
  buildProfileProposals,
  type ProfileProposalDraft,
} from "@/lib/domain/profile-import"
import { writeAudit } from "@/lib/server/audit"
import {
  reconcileCanonicalResource,
  updateCanonicalResource,
} from "@/lib/server/canonical-resources"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import type { readLiveFoodMenus } from "@/lib/server/food-menus"
import { ApiError } from "@/lib/server/http"
import {
  requireLocationAccess,
  visibilityPredicate,
} from "@/lib/server/permissions"
import type { readProfileStateBundle } from "@/lib/server/profile"
import type { Session } from "@/lib/server/session"

// The proposal projection, raise outcome and count shapes are the wire
// contract (lib/contracts/location-import-review.ts); re-exported here for
// existing server-side importers.
export type { ImportProposal, RaiseOutcome, RaiseTrigger }

type ProposalRow = {
  id: string
  resource_type: ProposalResourceType
  identity_key: string
  kind: ProposalKind
  field_key: string | null
  google_path: string | null
  section_label: string | null
  item_label: string | null
  match_status: string | null
  match_confidence: string | null
  canonical_value: unknown
  google_value: unknown
  suggested_patch: unknown
  warnings: unknown
  status: ProposalStatus
  decision: string | null
  failure_code: string | null
  pinned_canonical_revision: string
  pinned_canonical_hash: string
  pinned_google_hash: string
  raised_via: RaiseTrigger
  observed_at: Date
  decided_at: Date | null
  created_at: Date
}

function mapProposal(row: ProposalRow): ImportProposal {
  return {
    id: row.id,
    resourceType: row.resource_type,
    identityKey: row.identity_key,
    kind: row.kind,
    fieldKey: row.field_key,
    googlePath: row.google_path,
    sectionLabel: row.section_label,
    itemLabel: row.item_label,
    matchStatus: row.match_status,
    matchConfidence:
      row.match_confidence === null ? null : Number(row.match_confidence),
    canonicalValue: row.canonical_value,
    googleValue: row.google_value,
    suggestedPatch: row.suggested_patch,
    warnings: Array.isArray(row.warnings)
      ? row.warnings.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : [],
    status: row.status,
    decision: row.decision,
    failureCode: row.failure_code,
    pinnedCanonicalRevision: row.pinned_canonical_revision,
    raisedVia: row.raised_via,
    observedAt: row.observed_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  }
}

const PROPOSAL_COLUMNS = `
  id::text as id, resource_type, identity_key, kind, field_key, google_path,
  section_label, item_label, match_status, match_confidence,
  canonical_value, google_value, suggested_patch, warnings, status, decision,
  failure_code, pinned_canonical_revision, pinned_canonical_hash,
  pinned_google_hash, raised_via, observed_at, decided_at, created_at
`

function assertImportReviewEnabled() {
  if (!getServerEnv().IMPORT_REVIEW_ENABLED) {
    throw new ApiError(
      503,
      "import_review_paused",
      "Google import review is paused."
    )
  }
}

/**
 * Compares a stored jsonb column against a freshly built draft value. jsonb
 * does not preserve object key order, so a plain JSON.stringify of the
 * round-tripped column would differ from the draft for identical content.
 */
function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortKeys(entry)])
    )
  }
  return value ?? null
}

async function supersedePending(
  sql: TransactionSql,
  locationId: string,
  resourceType: ProposalResourceType,
  keepIdentityKeys: string[] = []
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update presence_import_proposal
    set status = 'superseded'
    where location_id = ${locationId}
      and resource_type = ${resourceType}
      and status = 'pending'
      ${
        keepIdentityKeys.length
          ? sql`and identity_key not in ${sql(keepIdentityKeys)}`
          : sql``
      }
    returning id
  `
  return rows.length
}

type ProposalInsert = {
  identityKey: string
  kind: ProposalKind
  fieldKey?: string | null
  googlePath?: string | null
  sectionLabel?: string | null
  itemLabel?: string | null
  matchStatus?: string | null
  matchConfidence?: number | null
  canonicalValue: unknown
  googleValue: unknown
  suggestedPatch: unknown
  warnings: string[]
}

type GatingProposal = {
  identityKey: string
  status: ProposalStatus
  googleValue: unknown
  canonicalValue: unknown
}

/**
 * The one earlier proposal per identity that can gate a re-raise: the live row
 * (`pending`/`processing` — at most one, by the partial unique index in 0028)
 * when there is one, otherwise the newest row the user deliberately ignored.
 *
 * `applied` and `failed` rows are deliberately excluded. An applied row leaves
 * the surface in sync so no draft is produced anyway, and a failed row is how
 * a user recovers from a bad decision — the next refresh must be able to
 * re-raise it.
 */
async function loadGatingProposals(
  sql: TransactionSql,
  locationId: string,
  resourceType: ProposalResourceType
): Promise<Map<string, GatingProposal>> {
  const rows = await sql<GatingProposal[]>`
    select distinct on (identity_key)
      identity_key as "identityKey", status,
      google_value as "googleValue", canonical_value as "canonicalValue"
    from presence_import_proposal
    where location_id = ${locationId}
      and resource_type = ${resourceType}
      and status in ('pending', 'processing', 'ignored')
    order by identity_key, (status in ('pending', 'processing')) desc, created_at desc
  `
  return new Map(rows.map((row) => [row.identityKey, row]))
}

type GatedDrafts = { fresh: ProposalInsert[]; keepIdentityKeys: string[] }

/**
 * Decides, per identity, whether this observation is actually new.
 *
 * Google-side drift is re-observed on every 15-minute sweep, and superseding
 * plus re-inserting unconditionally resurrects a suggestion the user ignored,
 * invalidates an open review's Apply with a 409 `proposal_superseded`, and
 * writes two rows per identity per tick until the 90-day expiry reaps them.
 *
 * The pins on the row are whole-resource hashes, so they move whenever any
 * field or item moves; the comparison here is per identity instead. An ignore
 * is a statement about Google's value, so only that side gates it. A live row
 * also compares the canonical side, so a local edit still supersedes the row
 * and re-raises it with a fresh "Here:" value and the conflict warning.
 */
function gateDrafts(
  drafts: ProposalInsert[],
  gating: Map<string, GatingProposal>
): GatedDrafts {
  const fresh: ProposalInsert[] = []
  const keepIdentityKeys: string[] = []
  for (const draft of drafts) {
    const previous = gating.get(draft.identityKey)
    // An in-flight decision owns the identity until it settles: the live-key
    // index would swallow the insert anyway, and counting that as a dropped
    // draft would make a normal Apply look like lost work. The next raise
    // after it settles re-evaluates the identity.
    if (previous?.status === "processing") continue
    if (previous && sameJsonValue(previous.googleValue, draft.googleValue)) {
      if (previous.status === "ignored") continue
      if (sameJsonValue(previous.canonicalValue, draft.canonicalValue)) {
        keepIdentityKeys.push(draft.identityKey)
        continue
      }
    }
    fresh.push(draft)
  }
  return { fresh, keepIdentityKeys }
}

async function insertProposals(input: {
  sql: TransactionSql
  organisationId: string
  locationId: string
  externalLocationId: string
  resourceType: ProposalResourceType
  batchId: string
  raisedVia: RaiseTrigger
  raisedBy: string | null
  pinned: {
    canonicalRevision: string
    canonicalHash: string
    googleHash: string
  }
  drafts: ProposalInsert[]
}): Promise<{ inserted: number; attempted: number }> {
  let inserted = 0
  for (const draft of input.drafts) {
    const rows = await input.sql<{ id: string }[]>`
      insert into presence_import_proposal (
        organisation_id, location_id, external_location_id, resource_type,
        identity_key, kind, field_key, google_path, section_label, item_label,
        match_status, match_confidence, canonical_value, google_value,
        suggested_patch, warnings, pinned_canonical_revision,
        pinned_canonical_hash, pinned_google_hash, batch_id, raised_via, raised_by
      ) values (
        ${input.organisationId}, ${input.locationId}, ${input.externalLocationId},
        ${input.resourceType}, ${draft.identityKey}, ${draft.kind},
        ${draft.fieldKey ?? null}, ${draft.googlePath ?? null},
        ${draft.sectionLabel ?? null}, ${draft.itemLabel ?? null},
        ${draft.matchStatus ?? null}, ${draft.matchConfidence ?? null},
        ${draft.canonicalValue === null || draft.canonicalValue === undefined ? null : input.sql.json(JSON.parse(JSON.stringify(draft.canonicalValue)) as never)},
        ${draft.googleValue === null || draft.googleValue === undefined ? null : input.sql.json(JSON.parse(JSON.stringify(draft.googleValue)) as never)},
        ${input.sql.json(JSON.parse(JSON.stringify(draft.suggestedPatch)) as never)},
        ${input.sql.json(draft.warnings as never)},
        ${input.pinned.canonicalRevision}, ${input.pinned.canonicalHash},
        ${input.pinned.googleHash}, ${input.batchId}, ${input.raisedVia},
        ${input.raisedBy}
      )
      on conflict (organisation_id, location_id, resource_type, identity_key)
        where status in ('pending', 'processing')
        do nothing
      returning id
    `
    inserted += rows.length
  }
  // `attempted` is what makes a draft lost to the live-key conflict
  // distinguishable from a draft that was never generated: the raise audit
  // reports the shortfall rather than silently under-reporting `raised`.
  return { inserted, attempted: input.drafts.length }
}

async function loadMenuIdentities(
  sql: TransactionSql,
  locationId: string
): Promise<MenuItemIdentity[]> {
  const rows = await sql<
    {
      google_path: string
      local_path: string
      section_label: string
      item_label: string
      price_units: string | null
      price_nanos: number | null
    }[]
  >`
    select google_path, local_path, section_label, item_label, price_units, price_nanos
    from food_menu_item_identity
    where location_id = ${locationId}
  `
  return rows.map((row) => ({
    googlePath: row.google_path,
    localPath: row.local_path,
    sectionLabel: row.section_label,
    itemLabel: row.item_label,
    priceUnits: row.price_units,
    priceNanos: row.price_nanos,
  }))
}

async function replaceMenuIdentities(
  sql: TransactionSql,
  organisationId: string,
  locationId: string,
  identities: MenuItemIdentity[]
) {
  await sql`
    delete from food_menu_item_identity where location_id = ${locationId}
  `
  for (const identity of identities) {
    await sql`
      insert into food_menu_item_identity (
        organisation_id, location_id, google_path, local_path,
        section_label, item_label, price_units, price_nanos, last_reconciled_at
      ) values (
        ${organisationId}, ${locationId}, ${identity.googlePath},
        ${identity.localPath}, ${identity.sectionLabel}, ${identity.itemLabel},
        ${identity.priceUnits}, ${identity.priceNanos}, now()
      )
      on conflict (organisation_id, location_id, google_path) do update set
        local_path = excluded.local_path, section_label = excluded.section_label,
        item_label = excluded.item_label, price_units = excluded.price_units,
        price_nanos = excluded.price_nanos, last_reconciled_at = now()
    `
  }
}

/**
 * Stages Google-side food-menu drift as import proposals. Suggestion-only:
 * this never mutates canonical data. Called from the presence-resources sweep
 * and the manual refresh route — never from interactive GET handlers.
 */
export async function raiseFoodMenuProposals(input: {
  session: Session
  locationId: string
  live: Awaited<ReturnType<typeof readLiveFoodMenus>>
  via: RaiseTrigger
  requestId: string
}): Promise<RaiseOutcome> {
  if (!getServerEnv().IMPORT_REVIEW_ENABLED) {
    return { raised: 0, superseded: 0, skipped: "disabled" }
  }
  const { session, locationId, live } = input
  const raisedBy = input.via === "manual" ? session.userId : null
  if (!live.state.eligible) {
    // Ineligible locations produce empty Google payloads; raising would
    // fabricate missing_from_google rows for the entire local menu.
    const superseded = await withTenant(session.organisationId, (sql) =>
      supersedePending(sql, locationId, "food_menus")
    )
    return { raised: 0, superseded, skipped: "not_eligible" }
  }
  const status = classifyResourceDrift({
    canonicalHash: live.state.canonicalHash,
    googleHash: live.state.googleHash,
    baselineCanonicalHash: live.canonicalResource.baselineCanonicalHash,
    baselineGoogleHash: live.canonicalResource.baselineGoogleHash,
  })
  const noBaseline =
    !live.canonicalResource.baselineCanonicalHash ||
    !live.canonicalResource.baselineGoogleHash

  if (status === "in_sync") {
    // Self-establish baselines and refresh identity pins: both sides are
    // identical right now, so local and Google paths coincide.
    const superseded = await withTenant(session.organisationId, async (sql) => {
      const count = await supersedePending(sql, locationId, "food_menus")
      await reconcileCanonicalResource({
        sql,
        organisationId: session.organisationId,
        locationId,
        resourceType: "food_menus",
        canonicalHash: live.state.canonicalHash,
        googleHash: live.state.googleHash,
      })
      await replaceMenuIdentities(
        sql,
        session.organisationId,
        locationId,
        identitiesFromAlignedMenus(live.state.canonicalMenus)
      )
      return count
    })
    return { raised: 0, superseded, skipped: "in_sync" }
  }
  if (status === "core_dirty" && !noBaseline) {
    // Google has not moved since the last reconcile; the difference is local
    // edits awaiting publish. Nothing to suggest — clear stale pendings.
    const superseded = await withTenant(session.organisationId, (sql) =>
      supersedePending(sql, locationId, "food_menus")
    )
    return { raised: 0, superseded, skipped: "core_dirty" }
  }

  const batchId = randomUUID()
  return withTenant(session.organisationId, async (sql) => {
    const identities = await loadMenuIdentities(sql, locationId)
    const drafts: MenuProposalDraft[] = buildFoodMenuProposals({
      canonicalMenus: live.state.canonicalMenus,
      googleMenus: live.state.googleMenus,
      identities,
    })
    const gated = gateDrafts(
      drafts.map((draft) => ({
        ...draft,
        warnings: noBaseline
          ? [...draft.warnings, "no_baseline"]
          : draft.warnings,
      })),
      await loadGatingProposals(sql, locationId, "food_menus")
    )
    const superseded = await supersedePending(
      sql,
      locationId,
      "food_menus",
      gated.keepIdentityKeys
    )
    const { inserted, attempted } = await insertProposals({
      sql,
      organisationId: session.organisationId,
      locationId,
      externalLocationId: live.context.externalLocationId,
      resourceType: "food_menus",
      batchId,
      raisedVia: input.via,
      raisedBy,
      pinned: {
        canonicalRevision: live.canonicalResource.revision,
        canonicalHash: live.state.canonicalHash,
        googleHash: live.state.googleHash,
      },
      drafts: gated.fresh,
    })
    await writeRaiseAudit(sql, {
      session,
      locationId,
      action: "food_menus.proposals.refreshed",
      requestId: input.requestId,
      trigger: input.via,
      batchId,
      raised: inserted,
      superseded,
      dropped: attempted - inserted,
    })
    return { raised: inserted, superseded, skipped: null }
  })
}

/**
 * The refresh audit row. Written only when something moved: with the per
 * identity gate a steady-state sweep raises and supersedes nothing, and a row
 * per drifted location every fifteen minutes would drown the trail it belongs
 * to. `dropped` counts drafts the live-key conflict swallowed — normally zero,
 * and non-zero only when two drafts collide on one identity.
 */
async function writeRaiseAudit(
  sql: TransactionSql,
  input: {
    session: Session
    locationId: string
    action: string
    requestId: string
    trigger: RaiseTrigger
    batchId: string
    raised: number
    superseded: number
    dropped: number
  }
) {
  if (input.raised === 0 && input.superseded === 0 && input.dropped === 0)
    return
  await writeAudit(sql, {
    organisationId: input.session.organisationId,
    actorUserId: input.session.userId,
    action: input.action,
    subjectType: "location",
    subjectId: input.locationId,
    requestId: input.requestId,
    metadata: {
      trigger: input.trigger,
      batchId: input.batchId,
      raised: input.raised,
      superseded: input.superseded,
      ...(input.dropped > 0 ? { dropped: input.dropped } : {}),
    },
  })
}

/** Profile counterpart of raiseFoodMenuProposals; same supersede semantics. */
export async function raiseProfileProposals(input: {
  session: Session
  locationId: string
  bundle: Awaited<ReturnType<typeof readProfileStateBundle>>
  via: RaiseTrigger
  requestId: string
}): Promise<RaiseOutcome> {
  if (!getServerEnv().IMPORT_REVIEW_ENABLED) {
    return { raised: 0, superseded: 0, skipped: "disabled" }
  }
  const { session, locationId, bundle } = input
  const raisedBy = input.via === "manual" ? session.userId : null
  const drafts: ProfileProposalDraft[] = buildProfileProposals({
    fields: bundle.state.fields,
  })
  const batchId = randomUUID()
  return withTenant(session.organisationId, async (sql) => {
    const gated = gateDrafts(
      drafts,
      await loadGatingProposals(sql, locationId, "profile")
    )
    const superseded = await supersedePending(
      sql,
      locationId,
      "profile",
      gated.keepIdentityKeys
    )
    const { inserted, attempted } = await insertProposals({
      sql,
      organisationId: session.organisationId,
      locationId,
      externalLocationId: bundle.context.externalLocationId,
      resourceType: "profile",
      batchId,
      raisedVia: input.via,
      raisedBy,
      pinned: {
        canonicalRevision: bundle.state.canonicalResource.revision,
        canonicalHash: bundle.state.canonicalHash,
        googleHash: bundle.state.googleHash,
      },
      drafts: gated.fresh,
    })
    await writeRaiseAudit(sql, {
      session,
      locationId,
      action: "profile.proposals.refreshed",
      requestId: input.requestId,
      trigger: input.via,
      batchId,
      raised: inserted,
      superseded,
      dropped: attempted - inserted,
    })
    return { raised: inserted, superseded, skipped: null }
  })
}

/**
 * Fails proposals stranded in `processing` by a crash between the claim
 * (transaction 1) and the settle (transaction 2). Until such a row leaves
 * `processing` the partial unique index blocks any fresh proposal for its
 * identity and the decision path refuses it as `proposal_not_pending`, so the
 * field is frozen for the user.
 *
 * Hosted on the presence-resources sweep because that is the only tick whose
 * cadence matches the fifteen minutes the predicate was written for; the
 * retention cron ran the same statement at most once a day. Runs regardless of
 * IMPORT_REVIEW_ENABLED: it is a repair, and pausing the surface must not
 * leave identities locked.
 */
export async function reapStrandedProposals(
  organisationId: string
): Promise<number> {
  const rows = await withTenant(
    organisationId,
    (sql) => sql<{ id: string }[]>`
      update presence_import_proposal
      set status = 'failed', failure_code = 'proposal_apply_failed',
        decided_at = now()
      where status = 'processing'
        and updated_at <= now() - interval '15 minutes'
      returning id
    `
  )
  return rows.length
}

export async function listImportProposals(input: {
  session: Session
  locationId: string
  resourceType?: ProposalResourceType
  includeDecided?: boolean
}): Promise<{
  proposals: ImportProposal[]
  counts: ImportReviewCounts
}> {
  return withTenant(input.session.organisationId, async (sql) => {
    await requireLocationAccess(sql, input.session, input.locationId)
    // requireLocationAccess trusts owner/admin roles; RLS scopes the queries
    // below, but the location itself must exist in this tenant for a 404 to
    // beat an empty-but-plausible response.
    const [location] = await sql<{ id: string }[]>`
      select id::text as id from location where id = ${input.locationId} limit 1
    `
    if (!location) {
      throw new ApiError(404, "location_not_found", "Location not found.")
    }
    const rows = await sql<ProposalRow[]>`
      select ${sql.unsafe(PROPOSAL_COLUMNS)}
      from presence_import_proposal
      where location_id = ${input.locationId}
        ${input.resourceType ? sql`and resource_type = ${input.resourceType}` : sql``}
        ${
          input.includeDecided
            ? sql`and status <> 'superseded'`
            : sql`and status in ('pending', 'processing')`
        }
      order by resource_type, section_label nulls first, item_label nulls first, created_at desc
    `
    const [counts] = await sql<ImportReviewCounts[]>`
      select
        count(*) filter (where status = 'pending')::int as pending,
        count(*) filter (where status = 'pending' and resource_type = 'profile')::int as profile,
        count(*) filter (where status = 'pending' and resource_type = 'food_menus')::int as "foodMenus"
      from presence_import_proposal
      where location_id = ${input.locationId}
    `
    return {
      proposals: rows.map(mapProposal),
      counts: counts ?? { pending: 0, profile: 0, foodMenus: 0 },
    }
  })
}

export async function pendingProposalCounts(input: {
  session: Session
}): Promise<PendingProposalCount[]> {
  return withTenant(input.session.organisationId, async (sql) => {
    const rows = await sql<PendingProposalCount[]>`
      select
        p.location_id::text as "locationId",
        p.resource_type as "resourceType",
        count(*)::int as pending
      from presence_import_proposal p
      where p.status = 'pending'
        and ${visibilityPredicate(sql, input.session, sql`p.location_id`)}
      group by p.location_id, p.resource_type
    `
    return rows
  })
}

async function markProposal(
  sql: TransactionSql,
  proposalId: string,
  status: "applied" | "ignored" | "failed",
  failureCode: string | null
) {
  await sql`
    update presence_import_proposal
    set status = ${status}, failure_code = ${failureCode}, decided_at = now()
    where id = ${proposalId} and status = 'processing'
  `
}

/**
 * Decision failures that release the claim instead of burning the proposal.
 * `canonical_resource_stale` is a pure optimistic-lock miss — the transaction
 * rolled back and nothing was written — and the acknowledgement 409 is not a
 * failure at all. `failed` stays reserved for outcomes a retry cannot fix
 * (proposal_patch_invalid, proposal_action_unsupported, proposal_target_missing).
 */
const RELEASABLE_DECISION_FAILURES = new Set([
  "canonical_overwrite_confirmation_required",
  "canonical_resource_stale",
])

/**
 * Claim -> plan -> act+mark -> (on failure) compensate. Deliberately THREE
 * separate tenant transactions, not one: the claim is the optimistic lock, the
 * act+mark commits atomically, and a failure after the claim must still be
 * able to persist the `failed` status — inside a single transaction the
 * rollback would erase it.
 */
export async function decideImportProposal(input: {
  session: Session
  locationId: string
  proposalId: string
  action: ProposalDecisionAction
  expectedCanonicalRevision: string
  confirmOverwriteCanonicalChanges: boolean
  requestId: string
}): Promise<{ proposal: ImportProposal; canonicalRevision: string | null }> {
  assertImportReviewEnabled()
  const { session, locationId, proposalId } = input

  // Claim (transaction 1).
  const claimed = await withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [row] = await sql<ProposalRow[]>`
      update presence_import_proposal
      set status = 'processing', decision = ${input.action}, decided_by = ${session.userId}
      where id = ${proposalId} and location_id = ${locationId} and status = 'pending'
      returning ${sql.unsafe(PROPOSAL_COLUMNS)}
    `
    if (row) return row
    const [existing] = await sql<{ status: ProposalStatus }[]>`
      select status from presence_import_proposal
      where id = ${proposalId} and location_id = ${locationId}
    `
    if (!existing) {
      throw new ApiError(
        404,
        "proposal_not_found",
        "This suggestion no longer exists."
      )
    }
    if (existing.status === "superseded") {
      throw new ApiError(
        409,
        "proposal_superseded",
        "This suggestion was refreshed from Google. Review the latest version."
      )
    }
    throw new ApiError(
      409,
      "proposal_not_pending",
      "This suggestion has already been decided."
    )
  })

  // Act + mark (transaction 2); compensate to `failed` (transaction 3) on error.
  try {
    return await withTenant(session.organisationId, async (sql) => {
      // Plan (re-validates the stored patch defensively).
      const plan = planDecision({
        action: input.action,
        row: {
          status: "processing",
          kind: claimed.kind,
          resourceType: claimed.resource_type,
          suggestedPatch: claimed.suggested_patch,
        },
      })

      // Conflict rows require the overwrite acknowledgement before Apply.
      const warnings = Array.isArray(claimed.warnings) ? claimed.warnings : []
      if (
        plan.type !== "mark_only" &&
        warnings.includes("canonical_also_changed") &&
        !input.confirmOverwriteCanonicalChanges
      ) {
        throw new ApiError(
          409,
          "canonical_overwrite_confirmation_required",
          "NabaPresence changed independently. Confirm the overwrite."
        )
      }

      let canonicalRevision: string | null = null
      if (plan.type === "mark_only") {
        await markProposal(sql, proposalId, "ignored", null)
      } else if (plan.type === "apply_profile_field") {
        canonicalRevision = await applyProfileFieldDecision(sql, {
          session,
          locationId,
          proposalId,
          expectedCanonicalRevision: input.expectedCanonicalRevision,
          patch: plan.patch,
          confirmOverwriteCanonicalChanges:
            input.confirmOverwriteCanonicalChanges,
          pinned: {
            canonicalHash: claimed.pinned_canonical_hash,
            canonicalValue: claimed.canonical_value,
          },
        })
        await markProposal(sql, proposalId, "applied", null)
      } else {
        canonicalRevision = await applyMenuDecision(sql, {
          session,
          locationId,
          proposalId,
          expectedCanonicalRevision: input.expectedCanonicalRevision,
          patch: plan.patch,
          confirmOverwriteCanonicalChanges:
            input.confirmOverwriteCanonicalChanges,
          pinnedCanonicalValue: claimed.canonical_value,
          googlePath: claimed.google_path,
          googleItemLabel: claimed.item_label,
          googleSectionLabel: claimed.section_label,
        })
        await markProposal(sql, proposalId, "applied", null)
      }

      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: `${claimed.resource_type === "profile" ? "profile" : "food_menus"}.proposal.${plan.type === "mark_only" ? "ignored" : "applied"}`,
        subjectType: "location",
        subjectId: locationId,
        requestId: input.requestId,
        metadata: {
          proposalId,
          decision: input.action,
          kind: claimed.kind,
          identityKey: claimed.identity_key,
        },
      })

      const [settled] = await sql<ProposalRow[]>`
        select ${sql.unsafe(PROPOSAL_COLUMNS)}
        from presence_import_proposal where id = ${proposalId}
      `
      return { proposal: mapProposal(settled), canonicalRevision }
    })
  } catch (error) {
    const failureCode =
      error instanceof ProposalDecisionError
        ? error.code
        : error instanceof MenuPatchTargetMissingError
          ? error.code
          : error instanceof ApiError
            ? error.code
            : "proposal_apply_failed"
    if (RELEASABLE_DECISION_FAILURES.has(failureCode)) {
      // Not failures: nothing was written, and the retry can succeed. Release
      // the claim so the acknowledged (or re-loaded) retry finds the row
      // pending — `failed` is terminal, and the claim only accepts `pending`.
      await withTenant(
        session.organisationId,
        (sql) => sql`
        update presence_import_proposal
        set status = 'pending', decision = null, decided_by = null
        where id = ${proposalId} and status = 'processing'
      `
      )
      throw error
    }
    await withTenant(session.organisationId, (sql) =>
      markProposal(sql, proposalId, "failed", failureCode)
    )
    if (error instanceof ProposalDecisionError) {
      throw new ApiError(409, error.code, error.message)
    }
    if (error instanceof MenuPatchTargetMissingError) {
      throw new ApiError(409, error.code, error.message)
    }
    throw error
  }
}

async function applyProfileFieldDecision(
  sql: TransactionSql,
  input: {
    session: Session
    locationId: string
    proposalId: string
    expectedCanonicalRevision: string
    patch: { fieldKey: string; value: string | null }
    confirmOverwriteCanonicalChanges: boolean
    pinned: { canonicalHash: string; canonicalValue: unknown }
  }
): Promise<string> {
  const [resource] = await sql<
    {
      revision: string
      payload: Record<string, string | null>
    }[]
  >`
    select revision::text as revision, payload
    from presence_canonical_resource
    where organisation_id = ${input.session.organisationId}
      and location_id = ${input.locationId}
      and resource_type = 'profile'
    limit 1
  `
  if (!resource) {
    throw new ApiError(
      409,
      "canonical_resource_stale",
      "The profile has not been loaded yet."
    )
  }
  if (resource.revision !== input.expectedCanonicalRevision) {
    throw new ApiError(
      409,
      "canonical_resource_stale",
      "The profile changed after it was loaded. Refresh and try again."
    )
  }
  // expectedCanonicalRevision is the client's freshness check and nothing
  // more: the panel sends whatever the profile tab last loaded, so it matches
  // the live row even when the user edited this very field after the proposal
  // was raised. The proposal's own view of the local value is what decides
  // whether Apply is an overwrite — same acknowledgement the stored
  // canonical_also_changed warning demands, so a silent destroy becomes a
  // confirm.
  if (
    !input.confirmOverwriteCanonicalChanges &&
    !sameJsonValue(
      input.pinned.canonicalValue,
      resource.payload[input.patch.fieldKey] ?? null
    )
  ) {
    throw new ApiError(
      409,
      "canonical_overwrite_confirmation_required",
      "NabaPresence changed independently. Confirm the overwrite."
    )
  }
  const payload = {
    ...resource.payload,
    [input.patch.fieldKey]: input.patch.value,
  }
  const updated = await updateCanonicalResource({
    sql,
    organisationId: input.session.organisationId,
    locationId: input.locationId,
    resourceType: "profile",
    expectedRevision: input.expectedCanonicalRevision,
    payload,
  })
  // The imported field now mirrors Google's raise-time value: mark it in_sync
  // with fresh per-field baselines.
  const valueHash = hashProfileValue(input.patch.value)
  await sql`
    update profile_field_state
    set status = 'in_sync',
      canonical_value = ${sql.json({ value: input.patch.value })},
      canonical_hash = ${valueHash},
      baseline_canonical_hash = ${valueHash},
      baseline_google_hash = ${valueHash},
      canonical_revision = ${updated.revision},
      last_reconciled_at = now(),
      observed_at = now()
    where location_id = ${input.locationId} and field_key = ${input.patch.fieldKey}
  `
  const [external] = await sql<{ id: string }[]>`
    select el.id::text as id
    from location_link ll
    join external_location el on el.id = ll.external_location_id
    where ll.location_id = ${input.locationId} and ll.is_active = true
    limit 1
  `
  if (external) {
    await sql`
      insert into profile_sync_attempt (
        organisation_id, location_id, external_location_id, actor_user_id,
        operation, direction, status, idempotency_key,
        pinned_canonical_revision, pinned_canonical_hash, pinned_google_hash,
        selected_fields, intended_payload, remote_proposal_id, finished_at
      ) values (
        ${input.session.organisationId}, ${input.locationId}, ${external.id},
        ${input.session.userId}, 'import_google', 'to_nabapresence', 'succeeded',
        ${`import:${input.proposalId}`}, ${input.expectedCanonicalRevision},
        ${input.pinned.canonicalHash}, ${valueHash},
        ${[input.patch.fieldKey]},
        ${sql.json({ value: input.patch.value })}, ${input.proposalId}, now()
      )
      on conflict (organisation_id, idempotency_key) do nothing
    `
  }
  return updated.revision
}

async function applyMenuDecision(
  sql: TransactionSql,
  input: {
    session: Session
    locationId: string
    proposalId: string
    expectedCanonicalRevision: string
    patch: Parameters<typeof applyFoodMenuPatch>[1]
    confirmOverwriteCanonicalChanges: boolean
    pinnedCanonicalValue: unknown
    googlePath: string | null
    googleItemLabel: string | null
    googleSectionLabel: string | null
  }
): Promise<string> {
  const [resource] = await sql<
    {
      revision: string
      payload: Array<Record<string, unknown>>
    }[]
  >`
    select revision::text as revision, payload
    from presence_canonical_resource
    where organisation_id = ${input.session.organisationId}
      and location_id = ${input.locationId}
      and resource_type = 'food_menus'
    limit 1
  `
  if (!resource) {
    throw new ApiError(
      409,
      "canonical_resource_stale",
      "The menu has not been loaded yet."
    )
  }
  if (resource.revision !== input.expectedCanonicalRevision) {
    throw new ApiError(
      409,
      "canonical_resource_stale",
      "The menu changed after it was loaded. Refresh and try again."
    )
  }
  const currentMenus = Array.isArray(resource.payload) ? resource.payload : []
  // Per-item counterpart of the profile guard: the revision the panel sent is
  // the live one even when the user edited this item after the proposal was
  // raised. merge_item and remove_item are the two ops with a local
  // counterpart the proposal pinned; insert_item has none, and the section ops
  // are whole-section moves the label lookup already validates.
  if (
    !input.confirmOverwriteCanonicalChanges &&
    (input.patch.op === "merge_item" || input.patch.op === "remove_item")
  ) {
    const current = locateMenuItem(
      currentMenus,
      input.patch.sectionLabel,
      input.patch.itemLabel
    )
    if (
      current &&
      !sameJsonValue(input.pinnedCanonicalValue, menuItemSummary(current))
    ) {
      throw new ApiError(
        409,
        "canonical_overwrite_confirmation_required",
        "NabaPresence changed independently. Confirm the overwrite."
      )
    }
  }
  const nextMenus = applyFoodMenuPatch(currentMenus, input.patch)
  const updated = await updateCanonicalResource({
    sql,
    organisationId: input.session.organisationId,
    locationId: input.locationId,
    resourceType: "food_menus",
    expectedRevision: input.expectedCanonicalRevision,
    payload: nextMenus,
  })
  const [external] = await sql<{ id: string }[]>`
    select el.id::text as id
    from location_link ll
    join external_location el on el.id = ll.external_location_id
    where ll.location_id = ${input.locationId} and ll.is_active = true
    limit 1
  `
  if (external) {
    await sql`
      insert into food_menus_sync_attempt (
        organisation_id, location_id, external_location_id, actor_user_id,
        status, operation, direction, idempotency_key,
        expected_canonical_revision, expected_canonical_hash, expected_google_hash,
        intended_payload, remote_proposal_id, finished_at
      ) values (
        ${input.session.organisationId}, ${input.locationId}, ${external.id},
        ${input.session.userId}, 'succeeded', 'import_google', 'to_nabapresence',
        ${`import:${input.proposalId}`}, ${input.expectedCanonicalRevision},
        ${hashFoodMenus(currentMenus)}, ${hashFoodMenus(nextMenus)},
        ${sql.json(JSON.parse(JSON.stringify(nextMenus)))},
        ${input.proposalId}, now()
      )
      on conflict (organisation_id, idempotency_key) do nothing
    `
  }
  // Re-pin the touched item's identity: after an applied import the local
  // item mirrors Google's raise-time content, located by Google's labels.
  if (
    input.googlePath &&
    input.googleItemLabel &&
    input.googleSectionLabel &&
    (input.patch.op === "merge_item" || input.patch.op === "insert_item")
  ) {
    const located = locateMenuItem(
      nextMenus,
      input.googleSectionLabel,
      input.googleItemLabel
    )
    if (located) {
      await sql`
        insert into food_menu_item_identity (
          organisation_id, location_id, google_path, local_path,
          section_label, item_label, price_units, price_nanos, last_reconciled_at
        ) values (
          ${input.session.organisationId}, ${input.locationId}, ${input.googlePath},
          ${located.path}, ${located.sectionLabel}, ${located.itemLabel},
          ${located.price?.units ?? null}, ${located.price?.nanos ?? null}, now()
        )
        on conflict (organisation_id, location_id, google_path) do update set
          local_path = excluded.local_path, section_label = excluded.section_label,
          item_label = excluded.item_label, price_units = excluded.price_units,
          price_nanos = excluded.price_nanos, last_reconciled_at = now()
      `
    }
  }
  return updated.revision
}
