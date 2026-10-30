/**
 * The retention inventory (plan P04-4): every table the schema holds, with
 * where its rows come from, what retention does to them, after how long, and
 * on whose authority. The purge (lib/server/retention/purge.ts) names its
 * datasets by the tables listed here, the dry run reports against it, and
 * tests/retention-inventory.test.ts fails when a migration creates a table
 * this list does not classify, when a purge step and its entry disagree, or
 * when a derived dataset is added without an approved window. The runbook's
 * "Retention inventory" table is rendered from it
 * (renderRetentionInventoryMarkdown), so the documentation cannot drift.
 *
 * A new table lands with its row here, in the same change as its migration.
 *
 * No `server-only` import: the inventory is data, read by tests and the docs
 * renderer as well as by the purge.
 */

/**
 * Where a dataset's rows come from:
 * - `google`: content received from Google (the 30-day cache rule applies);
 * - `customer`: what a tenant's people wrote, configured or asked for;
 * - `derived`: aggregates or usage records computed from other data;
 * - `operational`: state the platform keeps to run (attempts, cursors,
 *   ticks, deliveries, audit).
 */
export type RetentionProvenance =
  "google" | "customer" | "derived" | "operational"

/**
 * What retention does to the dataset's rows once its window has passed.
 * `redact` clears content columns and keeps the row; `delete` removes the
 * row; `keep` means retention has no window for it (rows go only with the
 * record that owns them).
 */
export type RetentionAction = "redact" | "delete" | "keep"

/**
 * Whether RETENTION_DELETES_ENABLED stops retention deleting the dataset's
 * rows: `gated` (every retention delete of it, by statement or by cascade,
 * answers to the switch), `ungated` (platform-level counters with no tenant
 * content, purged regardless), or `none` (retention never deletes it).
 */
export type RetentionDeletes = "gated" | "ungated" | "none"

/**
 * On whose authority the window stands:
 * - `published`: the rule is stated in the public privacy notice
 *   (app/(legal)/privacy/page.tsx);
 * - `lifecycle`: kept for the life of the record that owns it, and deleted
 *   with it; no separate window;
 * - `internal`: operational state with an engineering rule, holding no
 *   provider content beyond identifiers;
 * - `pending`: awaiting the named decision in docs/release/decision-log.md;
 *   `interim` is the explicit keep decision applied until it is made.
 */
export type RetentionApproval =
  | { status: "published" }
  | { status: "lifecycle" }
  | { status: "internal" }
  | { status: "pending"; decision: `D-${number}`; interim: string }

/**
 * What an unreleased legal hold on a review keeps of a dataset:
 * - `kept`: every row tied to the held review or its location, whole: no
 *   retention step or cascade changes them while the hold stands;
 * - `cascade`: the rows are not deleted with the held review's location on
 *   disconnect, but the dataset's own window still applies to them (expired
 *   attempts are deleted and provider payloads redacted as for any
 *   location);
 * - `none`: a hold does not reach the dataset.
 */
export type RetentionHold = "kept" | "cascade" | "none"

export type RetentionDataset = {
  table: string
  provenance: RetentionProvenance
  action: RetentionAction
  /** When the action applies, in words. */
  window: string
  /** The purge steps (purge.ts keys) that act on this table. */
  steps?: readonly string[]
  /**
   * Parents whose retention delete cascades to this table (ON DELETE
   * CASCADE): its rows go with them, in the same statement.
   */
  cascadeFrom?: readonly string[]
  /** A deleter outside the per-organisation purge. */
  handledBy?: string
  deletes: RetentionDeletes
  /** What an unreleased legal hold on a review does for the rows. */
  hold: RetentionHold
  approval: RetentionApproval
}

const RAW_CONTENT_WINDOW =
  "raw_content_expires_at: organisation.raw_content_retention_days (default 30, at most 30) after last receipt"

const DISCONNECT_WINDOW =
  "7 days after its Google connection is disconnected (purge_due_at)"

const KEPT_WITH_LOCATION =
  "while its location stays connected; deleted with the external location 7 days after disconnect"

const PENDING_UNDECIDED = (interim: string): RetentionApproval => ({
  status: "pending",
  decision: "D-47",
  interim,
})

export const RETENTION_INVENTORY = [
  // ---- Google content -----------------------------------------------------
  {
    table: "review",
    provenance: "google",
    action: "redact",
    window: `review text, reviewer name, photo link and raw payload at ${RAW_CONTENT_WINDOW}; the row ${DISCONNECT_WINDOW}`,
    steps: ["reviews", "disconnectedReviews"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  {
    table: "review_media_item",
    provenance: "google",
    action: "delete",
    window: `with its review's ${RAW_CONTENT_WINDOW}`,
    steps: ["media"],
    cascadeFrom: ["review"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  {
    table: "google_account",
    provenance: "google",
    action: "redact",
    window: `raw payload at ${RAW_CONTENT_WINDOW}; the row while its connection exists`,
    steps: ["accounts"],
    deletes: "none",
    hold: "none",
    approval: { status: "published" },
  },
  {
    table: "external_location",
    provenance: "google",
    action: "redact",
    window: `raw payload and address at ${RAW_CONTENT_WINDOW}; the row ${DISCONNECT_WINDOW}, unless a review of it is held`,
    steps: ["locations", "disconnectedLocations"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "published" },
  },
  {
    table: "processed_webhook_event",
    provenance: "google",
    action: "redact",
    window:
      "payload at payload_expires_at (30 days; legacy rows only, new events store no payload); the dedupe row is kept",
    steps: ["webhookPayloads"],
    deletes: "none",
    hold: "none",
    approval: { status: "published" },
  },
  {
    table: "profile_field_state",
    provenance: "google",
    action: "redact",
    window:
      "canonical and Google values at snapshot_expires_at (30 days after each observation)",
    steps: ["profileSnapshots"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "published" },
  },
  {
    table: "gbp_media_item",
    provenance: "google",
    action: "redact",
    window:
      "URLs, description, attribution, dimensions and insights at payload_expires_at (30 days after each observation)",
    steps: ["googleMediaPayloads"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "published" },
  },
  {
    table: "gbp_resource_snapshot",
    provenance: "google",
    action: "delete",
    window: "expires_at (30 days after each observation)",
    steps: ["resourceSnapshots"],
    deletes: "gated",
    hold: "none",
    approval: { status: "published" },
  },
  {
    table: "food_menus_state",
    provenance: "google",
    action: "delete",
    window: "expires_at (30 days after each observation)",
    steps: ["foodMenuStates"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "published" },
  },
  {
    table: "presence_import_proposal",
    provenance: "google",
    action: "delete",
    window: "expires_at (90 days after it is raised)",
    steps: ["importProposals"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "published" },
  },
  {
    table: "place_action_link",
    provenance: "google",
    action: "keep",
    window: KEPT_WITH_LOCATION,
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "kept",
    approval: {
      status: "pending",
      decision: "D-28",
      interim:
        "keep the mirrored links while the location stays connected; they are refreshed on every read",
    },
  },
  {
    table: "google_onboarding_draft",
    provenance: "google",
    action: "delete",
    window: "expires_at (180 days after it is started)",
    steps: ["onboardingDrafts"],
    deletes: "gated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "google_onboarding_review",
    provenance: "google",
    action: "delete",
    window: "with its onboarding draft",
    cascadeFrom: ["google_onboarding_draft"],
    deletes: "gated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "google_onboarding_creation",
    provenance: "google",
    action: "delete",
    window: "with its onboarding draft",
    cascadeFrom: ["google_onboarding_draft", "google_onboarding_review"],
    deletes: "gated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "google_onboarding_match_link_review",
    provenance: "google",
    action: "delete",
    window: "with its onboarding draft",
    cascadeFrom: ["google_onboarding_draft"],
    deletes: "gated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "google_onboarding_match_link",
    provenance: "google",
    action: "delete",
    window: "with its onboarding draft",
    cascadeFrom: ["google_onboarding_match_link_review"],
    deletes: "gated",
    hold: "none",
    approval: { status: "internal" },
  },

  // ---- Derived aggregates and usage ---------------------------------------
  {
    table: "performance_metric_daily",
    provenance: "derived",
    action: "keep",
    window: KEPT_WITH_LOCATION,
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "kept",
    approval: {
      status: "pending",
      decision: "D-28",
      interim:
        "keep daily figures while the location stays connected, as the privacy notice says",
    },
  },
  {
    table: "performance_search_keyword_monthly",
    provenance: "derived",
    action: "delete",
    window: "18 months after the metric month",
    steps: ["keywordHistory"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: {
      status: "pending",
      decision: "D-28",
      interim:
        "keep deleting keyword history after 18 months, as the privacy notice says",
    },
  },
  {
    table: "food_menu_item_identity",
    provenance: "derived",
    action: "keep",
    window: "for the life of the location",
    deletes: "none",
    hold: "none",
    approval: {
      status: "pending",
      decision: "D-28",
      interim:
        "keep the item mapping while the location exists; it is rebuilt on each menu reconcile",
    },
  },
  {
    table: "ai_usage",
    provenance: "derived",
    action: "delete",
    window:
      "13 months after creation, never while its allowance period is open or the row is reserved",
    steps: ["aiUsage"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  // S3: review topics. The labels hold no review text and outlive it, like
  // the star rating. Kept for the life of the review and deleted with it,
  // privacy erasure included (coordinator decision 2026-10-30; grandfathered
  // below while D-28 stays open). The feature ships off (org feature
  // review_topics) until the privacy notice covers classification.
  {
    table: "review_topic",
    provenance: "derived",
    action: "keep",
    window: "for the life of its review; deleted with it",
    cascadeFrom: ["review"],
    deletes: "gated",
    hold: "kept",
    approval: {
      status: "pending",
      decision: "D-28",
      interim:
        "keep each review's topic labels for the life of the review and delete them with it, erasure included (coordinator decision 2026-10-30)",
    },
  },
  {
    table: "review_topic_classification",
    provenance: "operational",
    action: "keep",
    window: "for the life of its review; deleted with it",
    cascadeFrom: ["review"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "lifecycle" },
  },

  // ---- Customer content ---------------------------------------------------
  {
    table: "organisation",
    provenance: "customer",
    action: "keep",
    window: "for the life of the account",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "app_user",
    provenance: "customer",
    action: "keep",
    window: "for the life of the account",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "member",
    provenance: "customer",
    action: "keep",
    window: "while the person is a member",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "location",
    provenance: "customer",
    action: "keep",
    window: "for the life of the location",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "location_member",
    provenance: "customer",
    action: "keep",
    window: "while the person is assigned to the location",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "location_link",
    provenance: "customer",
    action: "keep",
    window: KEPT_WITH_LOCATION,
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "lifecycle" },
  },
  {
    table: "client",
    provenance: "customer",
    action: "keep",
    window: "for the life of the client record",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "client_google_connection",
    provenance: "customer",
    action: "keep",
    window: "for the life of the client and connection",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "invitation",
    provenance: "customer",
    action: "keep",
    window: "kept after it is accepted or expires",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep accepted and expired invitations (email, role, inviter) for the life of the organisation"
    ),
  },
  {
    table: "invitation_delivery",
    provenance: "operational",
    action: "keep",
    window: "with its invitation; deleted when the invitation is revoked",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "draft",
    provenance: "customer",
    action: "keep",
    window: `${KEPT_WITH_LOCATION}; scrubbed by privacy erasure`,
    cascadeFrom: ["review"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  {
    table: "verification_result",
    provenance: "customer",
    action: "keep",
    window: "with its draft; reason messages scrubbed by privacy erasure",
    cascadeFrom: ["draft"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  {
    table: "approval_decision",
    provenance: "customer",
    action: "keep",
    window: "with its review",
    cascadeFrom: ["review"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  {
    table: "review_reply",
    provenance: "customer",
    action: "keep",
    window: `${KEPT_WITH_LOCATION}; scrubbed by privacy erasure`,
    cascadeFrom: ["review"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  {
    table: "publish_attempt",
    provenance: "operational",
    action: "keep",
    window: "with its reply",
    cascadeFrom: ["review_reply"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  {
    table: "publish_attempt_event",
    provenance: "operational",
    action: "keep",
    window: "with its publish attempt (append-only; yields only to retention)",
    cascadeFrom: ["publish_attempt"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  {
    table: "legal_hold",
    provenance: "customer",
    action: "keep",
    window:
      "with the review it protects; a released hold stays as its record, and an unreleased one blocks the review's redaction and delete (review_legal_hold_guard, 0141)",
    cascadeFrom: ["review"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "lifecycle" },
  },
  {
    table: "privacy_request",
    provenance: "customer",
    action: "keep",
    window: "kept after it is resolved",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep resolved privacy requests as the record of how each was answered"
    ),
  },
  {
    table: "gbp_local_post",
    provenance: "customer",
    action: "redact",
    window: `provider payload at provider_payload_expires_at; the post ${KEPT_WITH_LOCATION}`,
    steps: ["postPayloads", "strandedPosts"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "published" },
  },
  {
    table: "post_approval_decision",
    provenance: "customer",
    action: "keep",
    window: "with its post",
    cascadeFrom: ["gbp_local_post"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "lifecycle" },
  },
  // Scheduled post history: D-47 is open and its interim is keep, so no
  // purge step runs on these tables. 0122 purge_post_schedule_dataset holds
  // the P08-R6 180-day rule ready for when D-47 sets a period; nothing calls
  // it until then (tests/retention-inventory.test.ts).
  {
    table: "post_publication_schedule",
    provenance: "customer",
    action: "keep",
    window: "for the life of the location",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep finished and cancelled schedules for the life of the location"
    ),
  },
  {
    table: "post_publication_occurrence",
    provenance: "customer",
    action: "keep",
    window: "with its schedule",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep every occurrence, run or skipped, for the life of its schedule"
    ),
  },
  {
    table: "gbp_local_post_legacy_schedule",
    provenance: "customer",
    action: "keep",
    window: `with its post (${KEPT_WITH_LOCATION}); a dismissed one is kept too`,
    cascadeFrom: ["gbp_local_post"],
    deletes: "gated",
    hold: "kept",
    approval: PENDING_UNDECIDED(
      "keep every old per-post time, reviewed or not, for the life of its post"
    ),
  },
  {
    table: "presence_canonical_resource",
    provenance: "customer",
    action: "keep",
    window: "for the life of the location",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "bulk_listing_operation",
    provenance: "customer",
    action: "keep",
    window: "kept after it finishes",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep finished bulk operations for the life of the organisation"
    ),
  },
  {
    table: "bulk_listing_child",
    provenance: "customer",
    action: "keep",
    window: "with its bulk operation",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep each location's current and proposed values with its bulk operation"
    ),
  },
  // Bulk engine additions (P09-R3, P09-R7). Like the batches they belong
  // to, nothing deletes them until D-47 sets a period.
  {
    table: "bulk_listing_write_attempt",
    provenance: "operational",
    action: "keep",
    window:
      "with its bulk listing child (attributes and action-link writes and what their readback must find)",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep each bulk write attempt with its bulk operation"
    ),
  },
  {
    table: "media_asset",
    provenance: "customer",
    action: "keep",
    window:
      "a finalised photo is kept until decided; an upload never finalised has its staged object removed from private storage 24 hours after it started (staging_expires_at, purgeExpiredStagingAssets in the retention purge, while RETENTION_DELETES_ENABLED is on) and its row kept, marked purged",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep owned photos and their rows; remove only staged objects never finalised"
    ),
  },
  {
    table: "media_asset_publication",
    provenance: "customer",
    action: "keep",
    window: "with its photo asset (where each photo was published)",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep where each owned photo was published with the photo"
    ),
  },
  {
    table: "report_share",
    provenance: "customer",
    action: "keep",
    window: "kept after it expires or is revoked",
    deletes: "none",
    hold: "none",
    approval: {
      status: "pending",
      decision: "D-22",
      interim:
        "keep expired and revoked share rows (token hash only) for the life of the client",
    },
  },
  {
    table: "notification_preference",
    provenance: "customer",
    action: "keep",
    window: "while the person is a member",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "organisation_feature",
    provenance: "customer",
    action: "keep",
    window: "for the life of the organisation",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },

  // ---- Operational state --------------------------------------------------
  {
    table: "audit_log",
    provenance: "operational",
    action: "delete",
    window:
      "organisation.audit_retention_days (default 365) after it is written; never a held review's",
    steps: ["auditLogs"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "published" },
  },
  {
    table: "app_session",
    provenance: "operational",
    action: "delete",
    window: "7 days after it expires",
    steps: ["appSessions"],
    deletes: "gated",
    hold: "none",
    approval: { status: "published" },
  },
  {
    table: "hours_sync_attempt",
    provenance: "operational",
    action: "delete",
    window:
      "expires_at (365 days after it is created); in-flight rows aged to ambiguous after 24 hours",
    steps: ["hoursAttempts", "strandedHours"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "internal" },
  },
  {
    table: "profile_sync_attempt",
    provenance: "operational",
    action: "delete",
    window:
      "expires_at (365 days after it is created); in-flight rows aged to ambiguous after 24 hours",
    steps: ["profileAttempts", "strandedProfiles"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "internal" },
  },
  {
    table: "food_menus_sync_attempt",
    provenance: "operational",
    action: "delete",
    window:
      "expires_at (180 days after it is created); in-flight rows aged to ambiguous after 24 hours",
    steps: ["foodMenuAttempts", "strandedFoodMenus"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "internal" },
  },
  {
    table: "gbp_local_post_attempt",
    provenance: "operational",
    action: "delete",
    window: "expires_at (180 days after it is created)",
    steps: ["postAttempts"],
    cascadeFrom: ["gbp_local_post"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "internal" },
  },
  {
    table: "gbp_media_mutation",
    provenance: "operational",
    action: "delete",
    window:
      "expires_at (180 days after it is created), except an unresolved uncertain create; in-flight rows aged to ambiguous after 24 hours",
    steps: ["mediaMutations", "strandedMedia"],
    deletes: "gated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "place_action_mutation",
    provenance: "operational",
    action: "delete",
    window:
      "expires_at (180 days after it is created); in-flight rows aged to ambiguous after 24 hours",
    steps: ["placeActionMutations", "strandedPlaceActions"],
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "cascade",
    approval: { status: "internal" },
  },
  {
    table: "gbp_management_mutation",
    provenance: "operational",
    action: "delete",
    window:
      "expires_at (180 days after it is created); in-flight rows aged to ambiguous after 24 hours",
    steps: ["managementMutations", "strandedManagement"],
    deletes: "gated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "gbp_change_set",
    provenance: "operational",
    action: "delete",
    window:
      "expires_at (180 days after it is requested), once no Place Action attempt refers to it",
    steps: ["managementChangeSets"],
    deletes: "gated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "mutation_operation",
    provenance: "operational",
    action: "keep",
    window:
      "for the life of the organisation; approved requests whose dispatch never started are settled failed",
    steps: ["interruptedApprovals"],
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep every operation receipt as the outcome record of the write it answers"
    ),
  },
  {
    table: "mutation_approval_decision",
    provenance: "operational",
    action: "keep",
    window: "with its operation receipt",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "connection_task",
    provenance: "operational",
    action: "keep",
    window: "for the life of the connection",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "google_connection",
    provenance: "operational",
    action: "keep",
    window:
      "for the life of the organisation; tokens are cleared on disconnect",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "sync_checkpoint",
    provenance: "operational",
    action: "keep",
    window: KEPT_WITH_LOCATION,
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "internal" },
  },
  {
    table: "webhook_route",
    provenance: "operational",
    action: "keep",
    window: KEPT_WITH_LOCATION,
    cascadeFrom: ["external_location"],
    deletes: "gated",
    hold: "kept",
    approval: { status: "internal" },
  },
  {
    // Operational sweep and observation state, plus the Google payload of the
    // latest editor read (observed_google_payload, WP-11): that column is
    // provider content and is redacted 30 days after its read.
    table: "presence_resource_reconcile_state",
    provenance: "google",
    action: "redact",
    window:
      "the stored Google payload 30 days after the read that stored it; the row for the life of the location",
    steps: ["editorPayloads"],
    deletes: "none",
    hold: "none",
    approval: { status: "published" },
  },
  {
    table: "organisation_job_route",
    provenance: "operational",
    action: "keep",
    window: "for the life of the organisation",
    deletes: "none",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "notification_incident",
    provenance: "operational",
    action: "keep",
    window: "kept after it resolves",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep resolved incidents for the life of the organisation"
    ),
  },
  {
    table: "notification_delivery",
    provenance: "operational",
    action: "keep",
    window: "kept after it is sent or fails",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep delivery history for the life of the organisation"
    ),
  },
  {
    table: "notification_delivery_event",
    provenance: "operational",
    action: "keep",
    window: "with its delivery",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep provider delivery events with their delivery"
    ),
  },
  {
    table: "notification_digest",
    provenance: "operational",
    action: "keep",
    window: "kept after it is sent",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep digest records for the life of the organisation"
    ),
  },
  {
    table: "notification_recipient_state",
    provenance: "operational",
    action: "keep",
    window: "with its incident; cleared when a person marks it unread",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "notification_incident_recipient",
    provenance: "operational",
    action: "keep",
    window: "with its incident, or until the person's account is deleted",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "platform_incident",
    provenance: "operational",
    action: "keep",
    window: "kept after it resolves",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep resolved platform incidents as the operations record"
    ),
  },
  {
    table: "platform_incident_delivery",
    provenance: "operational",
    action: "keep",
    window: "with its incident",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep operator alert deliveries (recipient address included) with their incident"
    ),
  },
  {
    table: "risc_event",
    provenance: "operational",
    action: "keep",
    window: "kept as the Cross-Account Protection record",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep received security events as their record"
    ),
  },
  {
    table: "ops_heartbeat",
    provenance: "operational",
    action: "keep",
    window: "one row per tick, updated in place",
    deletes: "none",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "fleet_lease",
    provenance: "operational",
    action: "keep",
    window: "one row per tick, updated in place",
    deletes: "none",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "ops_pause_control",
    provenance: "operational",
    action: "keep",
    window: "one row per pause scope, updated in place",
    deletes: "none",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "ops_pause_event",
    provenance: "operational",
    action: "keep",
    window: "append-only history of pause changes",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep every pause change as the operator record"
    ),
  },
  {
    table: "cron_cursor",
    provenance: "operational",
    action: "keep",
    window: "one row per walk, updated in place",
    deletes: "none",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "google_rate_bucket",
    provenance: "operational",
    action: "keep",
    window: "one row per quota bucket, updated in place",
    deletes: "none",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "abuse_rate_bucket",
    provenance: "operational",
    action: "delete",
    window: "when its window ends (expires_at)",
    handledBy:
      "purgeEndedAbuseBuckets (lib/server/retention/purge.ts), once per cycle",
    deletes: "ungated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "mfa_pending_login",
    provenance: "operational",
    action: "delete",
    window:
      "when the five-minute sign-in ticket expires (expires_at); an enrollment ticket also goes with its session",
    cascadeFrom: ["app_session"],
    handledBy:
      "purgeExpiredMfaTickets (lib/server/retention/purge.ts), once per cycle",
    deletes: "ungated",
    hold: "none",
    approval: { status: "internal" },
  },
  // Billing (plan P07). None of it holds provider content: Stripe ids, plan
  // terms, allowances and an event body's hash, never a payload.
  {
    table: "billing_plan",
    provenance: "operational",
    action: "keep",
    window:
      "every catalog version, active or not: an organisation's plan_id keeps naming the terms it chose",
    deletes: "none",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "organisation_billing",
    provenance: "operational",
    action: "keep",
    window:
      "one row per organisation, updated in place, for the life of the account",
    deletes: "none",
    hold: "none",
    approval: { status: "lifecycle" },
  },
  {
    table: "ai_credit_period",
    provenance: "operational",
    action: "keep",
    window:
      "kept after the period ends: allowance grants and operator adjustments are the billing record; usage rows of a period still open are never purged (aiUsageInClosedPeriod)",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep every allowance period and adjustment for the life of the organisation"
    ),
  },
  {
    table: "billing_event",
    provenance: "operational",
    action: "keep",
    window:
      "kept after it is processed, ignored or dead (Stripe ids, event type and body hash; no payload)",
    deletes: "none",
    hold: "none",
    approval: PENDING_UNDECIDED(
      "keep settled Stripe event receipts as the billing processing record"
    ),
  },
  {
    table: "retention_cycle",
    provenance: "operational",
    action: "delete",
    window:
      "completed cycles 35 days after their day (RETENTION_CYCLE_KEEP_DAYS)",
    handledBy:
      "openOrResumeCycle (lib/server/retention/cycle.ts), when a new cycle opens",
    deletes: "ungated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "retention_cycle_org",
    provenance: "operational",
    action: "delete",
    window: "with its cycle",
    cascadeFrom: ["retention_cycle"],
    deletes: "ungated",
    hold: "none",
    approval: { status: "internal" },
  },
  {
    table: "schema_migration",
    provenance: "operational",
    action: "keep",
    window: "one row per applied migration",
    deletes: "none",
    hold: "none",
    approval: { status: "internal" },
  },
] as const satisfies readonly RetentionDataset[]

/** A table the inventory classifies. */
export type RetentionTable = (typeof RETENTION_INVENTORY)[number]["table"]

const byTable = new Map<string, RetentionDataset>(
  RETENTION_INVENTORY.map((dataset) => [dataset.table, dataset])
)

/** The inventory entry for a table, or undefined when it is unclassified. */
export function retentionDataset(table: string): RetentionDataset | undefined {
  return byTable.get(table)
}

/**
 * Derived datasets that existed, unapproved, when the inventory was
 * introduced, plus those a recorded decision admitted since. A derived
 * dataset outside this list needs a `published`
 * window before it lands: no new persistent aggregate is added while D-28 is
 * open (plan P04).
 */
export const GRANDFATHERED_PENDING_DERIVED: readonly string[] = [
  "performance_metric_daily",
  "performance_search_keyword_monthly",
  "food_menu_item_identity",
  // S3: coordinator decision 2026-10-30 (DECISIONS.md, option (a)): kept for
  // the life of the review, deleted with it (privacy erasure included); no
  // review text stored. D-28 stays open for the datasets above.
  "review_topic",
]

const HOLD_LABEL: Record<RetentionHold, string> = {
  kept: "yes",
  cascade: "cascade only",
  none: "no",
}

function approvalLabel(approval: RetentionApproval): string {
  return approval.status === "pending"
    ? `pending ${approval.decision}: ${approval.interim}`
    : approval.status
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ")
}

/**
 * The inventory as a Markdown table, embedded in docs/runbook.md between
 * the retention-inventory markers. tests/retention-inventory.test.ts keeps
 * the two equal.
 */
export function renderRetentionInventoryMarkdown(): string {
  const header = [
    "| Table | Provenance | Action | Window | Mechanism | Deletes | Hold | Approval |",
    "| ----- | ---------- | ------ | ------ | --------- | ------- | ---- | -------- |",
  ]
  const rows = [...RETENTION_INVENTORY]
    .sort((left, right) => left.table.localeCompare(right.table))
    .map((dataset: RetentionDataset) => {
      const mechanism = [
        ...(dataset.steps ?? []).map((step) => `\`${step}\``),
        ...(dataset.cascadeFrom ?? []).map(
          (parent) => `cascade from \`${parent}\``
        ),
        ...(dataset.handledBy ? [dataset.handledBy] : []),
      ].join(", ")
      return `| \`${dataset.table}\` | ${dataset.provenance} | ${dataset.action} | ${cell(dataset.window)} | ${cell(mechanism || "none")} | ${dataset.deletes} | ${HOLD_LABEL[dataset.hold]} | ${cell(approvalLabel(dataset.approval))} |`
    })
  return [...header, ...rows].join("\n")
}
