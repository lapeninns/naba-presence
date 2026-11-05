import { createHash } from "node:crypto"

import type postgres from "postgres"

import {
  canonicalJson,
  normalizeGoogleHours,
  semanticHours,
} from "../../../lib/domain/hours-vocabulary"

import type { GoogleStub } from "../../integration/helpers/google-stub"
import {
  seedGoogleConnection,
  seedLinkedLocation,
} from "../../integration/helpers/tenant"

export type EditorCapabilityFixture = {
  cookie: string
  reconnectLocationId: string
  unverifiedLocationId: string
}

/** Own tenant: never changes the shared board, reports or publishing journeys. */
export async function seedEditorCapabilityFixture(
  admin: ReturnType<typeof postgres>,
  stub: GoogleStub,
  organisationId: string,
  cookie: string,
  googleLocation: Record<string, unknown>
): Promise<EditorCapabilityFixture> {
  const ids: string[] = []
  for (const reconnect of [true, false]) {
    const connection = await seedGoogleConnection(admin, { organisationId })
    const linked = await seedLinkedLocation(admin, {
      organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    if (reconnect) {
      // A known rejected credential can have a still-valid cached token.
      // Reading the stub must not remove the operator's open reconnect task.
      await admin`insert into connection_task (organisation_id, google_connection_id, task_type) values (${organisationId}, ${connection.connectionId}, 'reconnect')`
    } else {
      await admin`update external_location set verified = false where id = ${linked.externalLocationId}`
      // A Google-side hours change must keep its recovery notice and adopt
      // action even while the independent verification advisory is visible.
      const previous = normalizeGoogleHours({
        regularHours: {
          periods: [
            {
              openDay: "MONDAY",
              openTime: { hours: 8 },
              closeDay: "MONDAY",
              closeTime: { hours: 16 },
            },
          ],
        },
      })
      // Same persisted digest as hashHours; use the client-safe vocabulary
      // directly because nm-serve's native TS loader resolves relative paths.
      const baseline = createHash("sha256")
        .update(canonicalJson(semanticHours(previous)))
        .digest("hex")
      await admin`insert into presence_canonical_resource (organisation_id, location_id, resource_type, payload, baseline_canonical_hash, baseline_google_hash) values (${organisationId}, ${linked.locationId}, 'hours', ${admin.json(previous)}, ${baseline}, ${baseline})`
    }
    stub.respond(
      {
        method: "GET",
        pathIncludes: `/v1/${linked.googleLocationName}?readMask`,
      },
      () => ({
        status: 200,
        json: {
          ...googleLocation,
          name: linked.googleLocationName,
          regularHours: {
            periods: [
              {
                openDay: "MONDAY",
                openTime: { hours: 9 },
                closeDay: "MONDAY",
                closeTime: { hours: 17 },
              },
            ],
          },
        },
      })
    )
    ids.push(linked.locationId)
  }
  return { cookie, reconnectLocationId: ids[0]!, unverifiedLocationId: ids[1]! }
}
