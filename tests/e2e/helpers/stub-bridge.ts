import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import type { FullConfig } from "@playwright/test"
import postgres from "postgres"

import { startGoogleStub } from "../../integration/helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../../integration/helpers/tenant"

export type JourneyState = {
  cookie: string
  organisationId: string
  directReview: {
    id: string
    locationId: string
    locationName: string
    text: string
  }
  approvalReview: {
    id: string
    locationId: string
    locationName: string
    text: string
  }
  externalLocationId: string
  timezone: string
}

export const journeyStatePath = resolve(
  process.cwd(),
  "test-results/e2e-journey-state.json"
)

export async function readJourneyState() {
  return JSON.parse(
    await readFile(journeyStatePath, "utf8")
  ) as JourneyState
}

export default async function startJourneyBridge(config: FullConfig) {
  const directDatabaseUrl = process.env.DIRECT_DATABASE_URL
  if (!directDatabaseUrl) {
    throw new Error("DIRECT_DATABASE_URL is required for Playwright journeys.")
  }

  const baseURL = config.projects[0]?.use.baseURL
  if (typeof baseURL !== "string") {
    throw new Error("Playwright baseURL is required for journey setup.")
  }
  const appPort = Number.parseInt(new URL(baseURL).port, 10)
  const stubPort =
    process.env.PLAYWRIGHT_GOOGLE_STUB_PORT ??
    String(appPort + 1)
  process.env.GOOGLE_STUB_PORT = stubPort

  const admin = postgres(directDatabaseUrl, { max: 1 })
  let organisationId: string | undefined
  let stub: Awaited<ReturnType<typeof startGoogleStub>> | undefined

  try {
    stub = await startGoogleStub()
    const tenant = await createTestTenant(admin)
    organisationId = tenant.organisationId
    const connection = await seedGoogleConnection(admin, {
      organisationId,
    })
    const directReview = await seedLinkedReview(admin, {
      organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Sprint 5 journey review",
      rating: 5,
    })
    const approvalReview = await seedLinkedReview(admin, {
      organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
      text: "Sprint 5 approval journey review",
      rating: 4,
    })

    const timezone = "Pacific/Auckland"
    await admin`
      update organisation
      set
        name = 'Sprint 5 Journey tenant',
        approval_required = false,
        require_two_person_approval = false,
        direct_publish_consent_at = now(),
        direct_publish_consent_by = ${tenant.userId},
        default_timezone = ${timezone}
      where id = ${organisationId}
    `
    const locations = await admin<
      { id: string; name: string }[]
    >`
      select id::text as id, name
      from location
      where organisation_id = ${organisationId}
      order by id
    `
    const externalLocations = await admin<
      { id: string; googleLocationName: string }[]
    >`
      select
        id::text as id,
        google_location_name as "googleLocationName"
      from external_location
      where organisation_id = ${organisationId}
    `
    const locationName = (locationId: string) => {
      const location = locations.find((item) => item.id === locationId)
      if (!location) throw new Error(`Journey location ${locationId} is missing.`)
      return location.name
    }
    const googleLocationName = (externalLocationId: string) => {
      const location = externalLocations.find(
        (item) => item.id === externalLocationId
      )
      if (!location) {
        throw new Error(
          `Journey external location ${externalLocationId} is missing.`
        )
      }
      return location.googleLocationName
    }

    stub.respond(
      { method: "GET", pathIncludes: "/accounts" },
      () => ({
        status: 200,
        json: {
          accounts: [
            {
              name: connection.googleAccountName,
              accountName: "Sprint 5 Stub account",
              type: "LOCATION_GROUP",
              role: "OWNER",
              permissionLevel: "OWNER_LEVEL",
            },
          ],
        },
      })
    )
    stub.respond(
      {
        method: "GET",
        pathIncludes: `/${connection.googleAccountName}/locations`,
      },
      () => ({
        status: 200,
        json: {
          locations: [
            {
              name: googleLocationName(directReview.externalLocationId),
              title: locationName(directReview.locationId),
              metadata: { hasVoiceOfMerchant: true },
              storefrontAddress: {
                addressLines: ["1 Journey Way"],
                locality: "Auckland",
                postalCode: "1010",
              },
            },
            {
              name: googleLocationName(approvalReview.externalLocationId),
              title: locationName(approvalReview.locationId),
              metadata: { hasVoiceOfMerchant: true },
              storefrontAddress: {
                addressLines: ["2 Journey Way"],
                locality: "Auckland",
                postalCode: "1010",
              },
            },
          ],
        },
      })
    )

    const state: JourneyState = {
      cookie: tenant.cookie,
      organisationId,
      directReview: {
        id: directReview.reviewId,
        locationId: directReview.locationId,
        locationName: locationName(directReview.locationId),
        text: "Sprint 5 journey review",
      },
      approvalReview: {
        id: approvalReview.reviewId,
        locationId: approvalReview.locationId,
        locationName: locationName(approvalReview.locationId),
        text: "Sprint 5 approval journey review",
      },
      externalLocationId: directReview.externalLocationId,
      timezone,
    }
    await mkdir(dirname(journeyStatePath), { recursive: true })
    await writeFile(journeyStatePath, JSON.stringify(state), "utf8")
  } catch (error) {
    await stub?.stop()
    if (organisationId) await destroyTenants(admin, [organisationId])
    await admin.end()
    throw error
  }

  return async () => {
    await stub?.stop()
    if (organisationId) await destroyTenants(admin, [organisationId])
    await admin.end()
    await rm(journeyStatePath, { force: true })
    delete process.env.GOOGLE_STUB_PORT
  }
}
