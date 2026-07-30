import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto"
import type postgres from "postgres"

import "./env-defaults"

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

function encryptHarnessSecret(value: string) {
  const tokenEncryptionKey =
    process.env.TOKEN_ENCRYPTION_KEY ??
    "route-harness-token-key-32-characters!!"
  const key = createHash("sha256")
    .update(tokenEncryptionKey, "utf8")
    .digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
}

export async function createTestTenant(
  admin: ReturnType<typeof postgres>,
  options: {
    role?: "owner" | "admin" | "member" | "viewer"
    canPublish?: boolean
  } = {}
) {
  const organisationId = randomUUID()
  const userId = randomUUID()
  const email = `harness-${organisationId.slice(0, 8)}@nabapresence.test`
  const token = randomBytes(32).toString("base64url")
  await admin`
    insert into organisation (id, slug, name)
    values (
      ${organisationId},
      ${`harness-${organisationId.slice(0, 12)}`},
      'Harness tenant'
    )
  `
  await admin`
    insert into app_user (id, email, display_name, default_organisation_id)
    values (${userId}, ${email}, 'Harness user', ${organisationId})
  `
  await admin`
    insert into member (organisation_id, user_id, role, can_publish)
    values (
      ${organisationId},
      ${userId},
      ${options.role ?? "owner"},
      ${options.canPublish ?? true}
    )
  `
  await admin`
    insert into app_session (
      token_hash,
      user_id,
      organisation_id,
      expires_at
    )
    values (
      ${sha256(token)},
      ${userId},
      ${organisationId},
      now() + interval '1 hour'
    )
  `
  return {
    organisationId,
    userId,
    email,
    cookie: `naba_session=${token}`,
  }
}

export async function seedReview(
  admin: ReturnType<typeof postgres>,
  input: { organisationId: string; text?: string; rating?: number }
) {
  const connectionId = randomUUID()
  const externalLocationId = randomUUID()
  const locationId = randomUUID()
  const reviewId = randomUUID()
  const marker = randomUUID()
  await admin`
    insert into google_connection (
      id,
      organisation_id,
      google_subject,
      google_email,
      scope,
      status
    )
    values (
      ${connectionId},
      ${input.organisationId},
      ${`harness-${marker}`},
      'harness@example.test',
      'business.manage',
      'active'
    )
  `
  await admin`
    insert into location (id, organisation_id, name)
    values (${locationId}, ${input.organisationId}, 'Harness location')
  `
  await admin`
    insert into external_location (
      id,
      organisation_id,
      google_connection_id,
      google_account_name,
      google_location_name,
      title,
      verified
    )
    values (
      ${externalLocationId},
      ${input.organisationId},
      ${connectionId},
      ${`accounts/${marker}`},
      ${`locations/${marker}`},
      'Harness location',
      true
    )
  `
  await admin`
    insert into review (
      id, organisation_id, location_id, external_location_id,
      google_review_name_ciphertext, google_review_name_hash,
      google_review_id_ciphertext, google_review_id_hash,
      reviewer_display_name, reviewer_is_anonymous, star_rating, review_text,
      detected_language_code, language_confidence, has_media,
      create_time, update_time, content_hash, workflow_status, raw_payload
    ) values (
      ${reviewId}, ${input.organisationId}, ${locationId},
      ${externalLocationId},
      ${encryptHarnessSecret(`reviews/${marker}`)},
      ${sha256(`name-${marker}`)},
      ${encryptHarnessSecret(marker)}, ${sha256(`id-${marker}`)},
      'Harness reviewer', false, ${input.rating ?? 4},
      ${input.text ?? "Great stay, lovely staff."},
      'en', 0.72, false, now() - interval '1 day',
      now() - interval '1 day', ${sha256(marker)}, 'new', '{}'::jsonb
    )
  `
  return { reviewId, locationId }
}

export async function seedGoogleConnection(
  admin: ReturnType<typeof postgres>,
  input: { organisationId: string }
) {
  const connectionId = randomUUID()
  const marker = randomUUID()
  const googleAccountName = `accounts/stub-${marker}`
  await admin`
    insert into google_connection (
      id,
      organisation_id,
      google_subject,
      google_email,
      scope,
      status,
      access_token_ciphertext,
      access_token_expires_at
    )
    values (
      ${connectionId},
      ${input.organisationId},
      ${`stub-subject-${marker}`},
      'stub@example.test',
      'business.manage',
      'active',
      ${encryptHarnessSecret("stub-access-token")},
      now() + interval '1 hour'
    )
  `
  await admin`
    insert into google_account (
      organisation_id,
      google_connection_id,
      google_account_name,
      account_name,
      is_active
    )
    values (
      ${input.organisationId},
      ${connectionId},
      ${googleAccountName},
      'Stub account',
      true
    )
  `
  return { connectionId, googleAccountName }
}

export async function seedLinkedReview(
  admin: ReturnType<typeof postgres>,
  input: {
    organisationId: string
    connectionId: string
    googleAccountName: string
    text?: string
    rating?: number
    replyState?: "PENDING" | "APPROVED" | "REJECTED"
  }
) {
  const externalLocationId = randomUUID()
  const locationId = randomUUID()
  const reviewId = randomUUID()
  const marker = randomUUID()
  const googleLocationName = `locations/stub-${marker}`
  const googleReviewName = `accounts/stub-account/locations/stub-location/reviews/${reviewId}`
  await admin`
    insert into external_location (
      id,
      organisation_id,
      google_connection_id,
      google_account_name,
      google_location_name,
      title,
      verified
    )
    values (
      ${externalLocationId},
      ${input.organisationId},
      ${input.connectionId},
      ${input.googleAccountName},
      ${googleLocationName},
      'Stub external location',
      true
    )
  `
  await admin`
    insert into location (id, organisation_id, name)
    values (
      ${locationId},
      ${input.organisationId},
      ${`Stub location ${marker.slice(0, 8)}`}
    )
  `
  await admin`
    insert into location_link (
      organisation_id,
      external_location_id,
      location_id,
      is_active
    )
    values (
      ${input.organisationId},
      ${externalLocationId},
      ${locationId},
      true
    )
  `
  await admin`
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
      reviewer_is_anonymous,
      star_rating,
      review_text,
      detected_language_code,
      language_confidence,
      has_media,
      create_time,
      update_time,
      content_hash,
      workflow_status,
      raw_payload
    )
    values (
      ${reviewId},
      ${input.organisationId},
      ${locationId},
      ${externalLocationId},
      ${encryptHarnessSecret(googleReviewName)},
      ${sha256(googleReviewName)},
      ${encryptHarnessSecret(reviewId)},
      ${sha256(reviewId)},
      'Stub reviewer',
      false,
      ${input.rating ?? 4},
      ${input.text ?? "A linked review for lifecycle testing."},
      'en',
      0.99,
      false,
      now() - interval '1 day',
      now() - interval '1 day',
      ${sha256(`content-${reviewId}`)},
      ${input.replyState === "REJECTED" ? "rejected" : input.replyState ? "published" : "new"},
      '{}'::jsonb
    )
  `
  if (input.replyState) {
    await admin`
      insert into review_reply (
        organisation_id,
        review_id,
        current_body,
        google_reply_state,
        publish_status,
        google_reply_updated_at
      )
      values (
        ${input.organisationId},
        ${reviewId},
        'Existing provider reply',
        ${input.replyState},
        ${input.replyState === "REJECTED" ? "rejected" : input.replyState === "APPROVED" ? "published" : "accepted"},
        now()
      )
    `
  }
  return {
    reviewId,
    locationId,
    externalLocationId,
    googleLocationName,
    googleReviewName,
  }
}

export async function saveHumanDraft(
  baseUrl: string,
  cookie: string,
  reviewId: string,
  body: string
) {
  const draftResponse = await fetch(
    `${baseUrl}/api/reviews/${reviewId}/drafts`,
    {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tone: "warm_professional",
        body,
      }),
    }
  )
  if (draftResponse.status !== 201) {
    throw new Error(
      `Draft creation failed (${draftResponse.status}): ${await draftResponse.text()}`
    )
  }
  const draft = (await draftResponse.json()) as { draftId: string }
  const detailResponse = await fetch(`${baseUrl}/api/reviews/${reviewId}`, {
    headers: { cookie },
  })
  if (!detailResponse.ok) {
    throw new Error(
      `Review detail failed (${detailResponse.status}): ${await detailResponse.text()}`
    )
  }
  const detail = (await detailResponse.json()) as {
    review: { updateTime: string }
  }
  return {
    draftId: draft.draftId,
    expectedReviewUpdateTime: detail.review.updateTime,
  }
}

export async function destroyTenants(
  admin: ReturnType<typeof postgres>,
  organisationIds: string[]
) {
  if (organisationIds.length === 0) return
  await admin.begin(async (sql) => {
    await sql`
      alter table audit_log disable trigger audit_log_no_update
    `
    await sql`
      alter table publish_attempt_event
      disable trigger publish_attempt_event_no_update
    `
    await sql`
      delete from organisation where id in ${sql(organisationIds)}
    `
    await sql`
      alter table publish_attempt_event
      enable trigger publish_attempt_event_no_update
    `
    await sql`
      alter table audit_log enable trigger audit_log_no_update
    `
  })
  await admin`
    delete from app_user
    where email like 'harness-%@nabapresence.test'
      and default_organisation_id is null
  `
}
