import { readFileSync } from "node:fs"

import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

const initialMigration = readFileSync(
  new URL("../supabase/migrations/0001_initial.sql", import.meta.url),
  "utf8"
).replace("create extension if not exists pgcrypto;", "")
const cleanupMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260729000400_remove_local_demo_data.sql",
    import.meta.url
  ),
  "utf8"
)

const organisationId = "00000000-0000-4000-8000-000000000001"

async function seedLocation(
  database: PGlite,
  input: {
    connectionId: string
    subject: string
    locationId: string
    externalLocationId: string
    googleLocationName: string
    locationName: string
    reviewId: string
    googleReviewHash: string
  }
) {
  await database.query(
    `
      insert into google_connection (
        id, organisation_id, google_subject, status, scope
      ) values ($1, $2, $3, 'active', 'business.manage')
    `,
    [input.connectionId, organisationId, input.subject]
  )
  await database.query(
    `
      insert into location (id, organisation_id, name)
      values ($1, $2, $3)
    `,
    [input.locationId, organisationId, input.locationName]
  )
  await database.query(
    `
      insert into external_location (
        id,
        organisation_id,
        google_connection_id,
        google_account_name,
        google_location_name,
        title,
        verified
      ) values ($1, $2, $3, $4, $5, $6, true)
    `,
    [
      input.externalLocationId,
      organisationId,
      input.connectionId,
      input.subject === "local-fixture" ? "accounts/local" : "accounts/real",
      input.googleLocationName,
      input.locationName,
    ]
  )
  await database.query(
    `
      insert into location_link (
        organisation_id, location_id, external_location_id
      ) values ($1, $2, $3)
    `,
    [organisationId, input.locationId, input.externalLocationId]
  )
  await database.query(
    `
      insert into review (
        id,
        organisation_id,
        location_id,
        external_location_id,
        google_review_name_ciphertext,
        google_review_name_hash,
        google_review_id_ciphertext,
        google_review_id_hash,
        reviewer_display_name,
        star_rating,
        review_text,
        create_time,
        update_time,
        content_hash
      ) values (
        $1,
        $2,
        $3,
        $4,
        decode('00', 'hex'),
        $5,
        decode('00', 'hex'),
        $5,
        'Reviewer',
        5,
        'Review text',
        now(),
        now(),
        $5
      )
    `,
    [
      input.reviewId,
      organisationId,
      input.locationId,
      input.externalLocationId,
      input.googleReviewHash,
    ]
  )
}

describe("local demo cleanup migration", () => {
  it("removes the explicit local fixture graph and preserves Google data", async () => {
    const database = new PGlite()
    try {
      await database.exec(initialMigration)
      await database.query(
        "insert into organisation (id, slug, name) values ($1, 'test', 'Test')",
        [organisationId]
      )
      await database.query(
        "select set_config('app.organisation_id', $1, false)",
        [organisationId]
      )

      await seedLocation(database, {
        connectionId: "00000000-0000-4000-8000-000000000010",
        subject: "local-fixture",
        locationId: "00000000-0000-4000-8000-000000000011",
        externalLocationId: "00000000-0000-4000-8000-000000000012",
        googleLocationName: "locations/local",
        locationName: "Lapen Inns · Local Demo",
        reviewId: "00000000-0000-4000-8000-000000000014",
        googleReviewHash: "local-fixture-001",
      })
      await seedLocation(database, {
        connectionId: "10000000-0000-4000-8000-000000000010",
        subject: "real-google-subject",
        locationId: "10000000-0000-4000-8000-000000000011",
        externalLocationId: "10000000-0000-4000-8000-000000000012",
        googleLocationName: "locations/123456789",
        locationName: "Real Google location",
        reviewId: "10000000-0000-4000-8000-000000000014",
        googleReviewHash: "real-google-review-hash",
      })

      await database.exec(cleanupMigration)

      const counts = await database.query<{
        demo_connections: number
        demo_locations: number
        demo_reviews: number
        real_connections: number
        real_reviews: number
      }>(`
        select
          (select count(*)::integer from google_connection
            where google_subject = 'local-fixture') as demo_connections,
          (select count(*)::integer from location
            where name = 'Lapen Inns · Local Demo') as demo_locations,
          (select count(*)::integer from review
            where id = '00000000-0000-4000-8000-000000000014') as demo_reviews,
          (select count(*)::integer from google_connection
            where google_subject = 'real-google-subject') as real_connections,
          (select count(*)::integer from review
            where id = '10000000-0000-4000-8000-000000000014') as real_reviews
      `)
      expect(counts.rows).toEqual([
        {
          demo_connections: 0,
          demo_locations: 0,
          demo_reviews: 0,
          real_connections: 1,
          real_reviews: 1,
        },
      ])

      const versions = await database.query<{ version: string }>(
        "select version from schema_migration where version = '20260729000400_remove_local_demo_data'"
      )
      expect(versions.rows).toEqual([
        { version: "20260729000400_remove_local_demo_data" },
      ])
    } finally {
      await database.close()
    }
  })
})
