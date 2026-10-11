import "server-only"

import type { TransactionSql } from "postgres"

import type { WorkspaceMode } from "@/lib/contracts/session"
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

  let homeClientId: string | null
  let refiledLocations = 0
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
    // A home flag left on an archived client (only possible from tooling)
    // would collide with client_one_home once the sole client is promoted.
    await sql`
      update client set is_home = false
      where organisation_id = ${organisationId}
        and is_home
        and archived_at is not null
    `
    const sole = active[0]
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
      clientRequestId: input.clientRequestId ?? null,
    },
  })
  return {
    workspaceMode: input.workspaceMode,
    changed: true,
    refiledLocations,
  }
}
