import "server-only"

import type { TransactionSql } from "postgres"

import type { WorkspaceMode } from "@/lib/contracts/session"
import { SUBSCRIBED_STATES } from "@/lib/domain/billing-lifecycle"
import type { BillingState } from "@/lib/domain/entitlements"
import { writeAudit } from "@/lib/server/audit"
import { createHomeClient } from "@/lib/server/clients"
import { ApiError } from "@/lib/server/http"

export type WorkspaceModeChange = {
  workspaceMode: WorkspaceMode
  changed: boolean
  refiledLocations: number
}

/**
 * The name a home client created by a mode change takes: the organisation's
 * own, unless an archived client already holds it (client names are unique
 * per organisation, archived or not).
 */
async function freeHomeClientName(
  sql: TransactionSql,
  organisationId: string,
  name: string
): Promise<string> {
  const [taken] = await sql<{ taken: boolean }[]>`
    select exists (
      select 1 from client
      where organisation_id = ${organisationId} and name = ${name}
    ) as taken
  `
  return taken?.taken ? `${name} (business)` : name
}

/**
 * Locks the organisation's billing row and refuses a mode switch while it
 * could still carry a plan for the current mode (see changeWorkspaceMode).
 */
async function refuseWhileSubscribed(
  sql: TransactionSql,
  organisationId: string
): Promise<void> {
  const [billing] = await sql<
    {
      state: BillingState
      hasSubscription: boolean
      checkoutOpen: boolean
    }[]
  >`
    select
      state,
      stripe_subscription_id is not null as "hasSubscription",
      coalesce(checkout_expires_at > now(), false) as "checkoutOpen"
    from organisation_billing
    where organisation_id = ${organisationId}
    for update
  `
  if (!billing) return
  const reason = SUBSCRIBED_STATES.includes(billing.state)
    ? "subscription"
    : billing.state === "read_only" && billing.hasSubscription
      ? "subscription"
      : billing.checkoutOpen
        ? "checkout_open"
        : null
  if (!reason) return
  throw new ApiError(
    409,
    "billing_subscription_active",
    reason === "checkout_open"
      ? "A subscription checkout is open for this workspace. Finish it or let it expire before switching workspace mode."
      : "This workspace's subscription is for its current mode. Cancel it from Billing, and switch once it has ended.",
    { details: { reason, state: billing.state } }
  )
}

/**
 * Switches an organisation between business and agency mode. Runs inside
 * the organisation's tenant transaction; the caller has already checked the
 * actor is an owner.
 *
 * The organisation row is locked FOR UPDATE first. Migration 0102's client
 * trigger takes FOR SHARE on the same row before any active non-home client
 * is written, so no client can appear between the count below and the
 * commit.
 *
 * - business to agency: the mode flips first, then the home client is
 *   demoted to an ordinary client (0061's trigger refuses the demotion while
 *   the organisation is still in business mode). Its locations, grants and
 *   report shares stay where they are; it simply becomes visible.
 * - agency to business: refused with more than one active client. The sole
 *   active client becomes the home client, or a home client is created when
 *   there is none. Every location not filed under it (unassigned ones, and
 *   any still under an archived client) is refiled there before the mode
 *   flips, so the business invariant holds at commit.
 *
 * Report shares are scoped by location.client_id when they are read, so
 * refiling under a client that has live share links widens what those links
 * show to people outside the organisation. When that would happen the switch
 * is refused (409 `workspace_mode_report_shares`, with the counts) unless the
 * caller sends `confirmReportShares`; the audit row records the share ids.
 * Migration 0103's location trigger holds new locations to the same lock, so
 * the count of locations to refile is exact.
 *
 * A billing plan belongs to one workspace mode (0109's
 * organisation_billing_plan_matches), so the switch is refused (409
 * `billing_subscription_active`) while billing could still hold a plan for
 * the current mode: a running subscription (trialing, active, past_due,
 * grace), a read-only one Stripe can still recover, or an unexpired Checkout
 * session. Switching then would derive access from the other mode's plan and
 * make the processor's next write fail the trigger until its events went
 * dead. The billing row is locked after the organisation row (the order the
 * billing writers never reverse: they lock billing and only read the
 * organisation), so no write lands between the check and the commit. A
 * pilot, a canceled subscription and an ended read-only one switch freely.
 *
 * A request for the mode the organisation is already in changes nothing and
 * writes no audit row.
 */
export async function changeWorkspaceMode(
  sql: TransactionSql,
  input: {
    organisationId: string
    actorUserId: string
    workspaceMode: WorkspaceMode
    requestId: string
    clientRequestId?: string | null
    /** The owner has seen which live report shares the refile widens. */
    confirmReportShares?: boolean
  }
): Promise<WorkspaceModeChange> {
  const { organisationId } = input
  const [organisation] = await sql<{ name: string; mode: WorkspaceMode }[]>`
    select name, workspace_mode as mode
    from organisation
    where id = ${organisationId}
    for update
  `
  if (!organisation) {
    throw new ApiError(404, "organisation_not_found", "Organisation not found.")
  }
  if (organisation.mode === input.workspaceMode) {
    return {
      workspaceMode: organisation.mode,
      changed: false,
      refiledLocations: 0,
    }
  }
  await refuseWhileSubscribed(sql, organisationId)

  let homeClientId: string | null
  let refiledLocations = 0
  let reportShareIds: string[] = []
  if (input.workspaceMode === "agency") {
    await sql`
      update organisation set workspace_mode = 'agency'
      where id = ${organisationId}
    `
    const [demoted] = await sql<{ id: string }[]>`
      update client set is_home = false
      where organisation_id = ${organisationId} and is_home
      returning id::text as id
    `
    homeClientId = demoted?.id ?? null
  } else {
    const active = await sql<{ id: string; isHome: boolean }[]>`
      select id::text as id, is_home as "isHome"
      from client
      where organisation_id = ${organisationId} and archived_at is null
      order by created_at, id
      for update
    `
    if (active.length > 1) {
      throw new ApiError(
        409,
        "workspace_mode_too_many_clients",
        `This agency has ${active.length} active clients. A business workspace holds one, so archive the others before switching.`,
        { details: { activeClients: active.length } }
      )
    }
    const sole = active[0]
    if (sole) {
      // A created home client has no shares, so only the sole client's
      // live links can start covering refiled locations.
      const [exposure] = await sql<
        { locationsToRefile: number; shareIds: string[] }[]
      >`
        select
          (select count(*)::int from location
            where organisation_id = ${organisationId}
              and client_id is distinct from ${sole.id}) as "locationsToRefile",
          coalesce(
            (select array_agg(id::text order by created_at, id)
               from report_share
              where organisation_id = ${organisationId}
                and client_id = ${sole.id}
                and revoked_at is null
                and expires_at > now()),
            '{}'
          ) as "shareIds"
      `
      if (exposure && exposure.locationsToRefile > 0) {
        reportShareIds = exposure.shareIds
        if (reportShareIds.length > 0 && !input.confirmReportShares) {
          throw new ApiError(
            409,
            "workspace_mode_report_shares",
            `${exposure.locationsToRefile} location(s) would be filed under a client with ${reportShareIds.length} live report share link(s), which would then show them. Confirm to switch anyway, or revoke the links first.`,
            {
              details: {
                locationsToRefile: exposure.locationsToRefile,
                activeReportShares: reportShareIds.length,
              },
            }
          )
        }
      }
    }
    // A home flag left on an archived client (only possible from tooling)
    // would collide with client_one_home once the sole client is promoted.
    await sql`
      update client set is_home = false
      where organisation_id = ${organisationId}
        and is_home
        and archived_at is not null
    `
    if (sole) {
      homeClientId = sole.id
      if (!sole.isHome) {
        await sql`update client set is_home = true where id = ${sole.id}`
      }
    } else {
      homeClientId = await createHomeClient(
        sql,
        organisationId,
        await freeHomeClientName(sql, organisationId, organisation.name)
      )
    }
    const refiled = await sql<{ id: string }[]>`
      update location
         set client_id = ${homeClientId}
       where organisation_id = ${organisationId}
         and client_id is distinct from ${homeClientId}
      returning id::text as id
    `
    refiledLocations = refiled.length
    await sql`
      update organisation set workspace_mode = 'business'
      where id = ${organisationId}
    `
  }

  await writeAudit(sql, {
    organisationId,
    actorUserId: input.actorUserId,
    action: "organisation.mode.changed",
    subjectType: "organisation",
    subjectId: organisationId,
    requestId: input.requestId,
    metadata: {
      previousMode: organisation.mode,
      workspaceMode: input.workspaceMode,
      homeClientId,
      refiledLocations,
      // Live share links on the home client that now cover the refiled
      // locations (empty when nothing was refiled).
      reportShareIds,
      clientRequestId: input.clientRequestId ?? null,
    },
  })
  return {
    workspaceMode: input.workspaceMode,
    changed: true,
    refiledLocations,
  }
}
