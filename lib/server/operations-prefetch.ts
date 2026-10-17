import "server-only"

import {
  operationsHealthSchema,
  webhookFailuresResponseSchema,
} from "@/lib/contracts/operations"
import { queryKeys } from "@/lib/queries/keys"
import { withTenant } from "@/lib/server/db"
import {
  loadOrganisationHealth,
  loadWebhookFailures,
} from "@/lib/server/operations-health"
import { schedulerLiveness } from "@/lib/server/ops-liveness"
import {
  readOrgSettings,
  throughWire,
  type PrefetchEntry,
} from "@/lib/server/prefetch"
import type { Session } from "@/lib/server/session"

/**
 * /settings/operations: the health counters, the failed Pub/Sub events and
 * the organisation settings (for its time zone), read side by side so the
 * page paints its figures in the first HTML instead of three skeletons
 * (SET-22, as Team and Notifications already do). Only for owners and
 * admins: the only roles the page serves and both routes answer.
 */
export function operationsPrefetch(): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (session.role !== "owner" && session.role !== "admin") return []
    return [
      {
        queryKey: queryKeys.operationsHealth,
        load: async () => {
          const liveness = await schedulerLiveness()
          const payload = await withTenant(session.organisationId, (sql) =>
            loadOrganisationHealth(sql, liveness)
          )
          return throughWire(operationsHealthSchema, payload)
        },
      },
      {
        queryKey: queryKeys.webhookFailures,
        load: async () =>
          throughWire(
            webhookFailuresResponseSchema,
            await withTenant(session.organisationId, loadWebhookFailures)
          ),
      },
      { queryKey: queryKeys.settings, load: () => readOrgSettings(session) },
    ]
  }
}
