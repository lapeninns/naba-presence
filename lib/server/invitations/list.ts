import "server-only"

import type { TransactionSql } from "postgres"

import type { InvitationsResponse } from "@/lib/contracts/invitations"
import type { LocationScope, MemberRole } from "@/lib/contracts/members"
import { decryptSecret } from "@/lib/server/crypto"
import { getServerEnv } from "@/lib/server/env"
import {
  invitationEmailEnabled,
  serialiseDelivery,
} from "@/lib/server/invitations/delivery"

/**
 * What `GET /api/invitations` answers: the invitations nobody has accepted
 * yet, newest first, each with its link and its latest email delivery, and
 * whether this organisation emails its invitations. Shared with the /team
 * prefetch (lib/server/prefetch.ts), which serves the same owners and admins.
 */
export async function loadInvitations(
  sql: TransactionSql,
  organisationId: string
): Promise<InvitationsResponse> {
  const emailDelivery = await invitationEmailEnabled(sql, organisationId)
  const rows = await sql<
    Array<{
      id: string
      email: string
      role: MemberRole
      canPublish: boolean
      clients: { id: string; name: string }[] | null
      locations: { id: string; name: string }[] | null
      locationScope: LocationScope
      tokenCiphertext: Buffer
      expiresAt: Date
      acceptedAt: Date | null
      createdAt: Date
      delivery: {
        id: string
        kind: "initial" | "resend"
        status: "pending" | "sent" | "failed" | "suppressed" | "uncertain"
        errorCode: string | null
        attempts: number
        sentAt: string | null
        createdAt: string
      } | null
    }>
  >`
    select
      i.id::text as id,
      email,
      role,
      can_publish as "canPublish",
      case when i.client_ids is null then null else (
        select coalesce(
          json_agg(json_build_object('id', c.id::text, 'name', c.name) order by lower(c.name)),
          '[]'::json
        )
        from client c
        where c.id = any(i.client_ids)
      ) end as clients,
      case when i.location_ids is null then null else (
        select coalesce(
          json_agg(json_build_object('id', l.id::text, 'name', l.name) order by lower(l.name)),
          '[]'::json
        )
        from location l
        where l.id = any(i.location_ids)
      ) end as locations,
      location_scope as "locationScope",
      token_ciphertext as "tokenCiphertext",
      expires_at as "expiresAt",
      i.accepted_at as "acceptedAt",
      i.created_at as "createdAt",
      (
        select json_build_object(
          'id', d.id::text,
          'kind', d.kind,
          'status', d.status,
          'errorCode', d.last_error_code,
          'attempts', d.attempts,
          'sentAt', d.sent_at,
          'createdAt', d.created_at
        )
        from invitation_delivery d
        where d.invitation_id = i.id
        order by d.created_at desc, d.id desc
        limit 1
      ) as delivery
    from invitation i
    where i.accepted_at is null
    order by i.created_at desc
  `
  const baseUrl = getServerEnv().NEXTAUTH_URL ?? "http://localhost:3000"
  const items = rows.map(({ tokenCiphertext, delivery, ...row }) => ({
    ...row,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    inviteUrl: new URL(
      `/invite/${decryptSecret(tokenCiphertext)}`,
      baseUrl
    ).toString(),
    delivery: delivery
      ? serialiseDelivery({
          ...delivery,
          sentAt: delivery.sentAt ? new Date(delivery.sentAt) : null,
          createdAt: new Date(delivery.createdAt),
        })
      : null,
  }))
  return { items, emailDelivery }
}
