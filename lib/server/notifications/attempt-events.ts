import "server-only"

import type { OperationalEvent } from "@/lib/contracts/operational-events"
import { withTenant } from "@/lib/server/db"
import { log } from "@/lib/server/logger"

import { recordOperationalEvent } from "./operational"

type Family = Extract<OperationalEvent, { kind: "publication_failed" }>["source"]["family"]
export type AttemptOutcome =
  | { kind: "publication_failed"; reason: Extract<OperationalEvent, { kind: "publication_failed" }>["reason"] }
  | { kind: "publication_unresolved"; reason: Extract<OperationalEvent, { kind: "publication_unresolved" }>["reason"] }
  | { kind: "publication_confirmed" }

/**
 * Reports a write attempt's settled outcome as an operational event. The
 * write's own record is already committed; a failure here is logged and
 * never turns a recorded outcome into an error for the person who sent it.
 */
export async function reportAttemptOutcome(input: {
  organisationId: string; locationId: string; family: Family; attemptId: string; outcome: AttemptOutcome
}) {
  const event = {
    version: 1, organisationId: input.organisationId, occurredAt: new Date().toISOString(),
    target: { type: "location", locationId: input.locationId },
    source: { type: "attempt", family: input.family, id: input.attemptId },
    ...input.outcome,
  } as OperationalEvent
  try {
    await withTenant(input.organisationId, (sql) => recordOperationalEvent(sql, event))
  } catch (error) {
    log.error("notifications.attempt_event_failed", { organisationId: input.organisationId, attemptId: input.attemptId, kind: input.outcome.kind, error })
  }
}
