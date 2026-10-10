import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  googleAccountManagementRequest,
  googleCategoriesRequest,
  googleHealthcareRequest,
  googleLocationAttributesPatchRequest,
  googleLocationCreateRequest,
  googleLocationPatchRequest,
  googleLodgingRequest,
  googleMediaBinaryUploadRequest,
  googleMediaStartUploadRequest,
  googleVerificationRequest,
} from "@/lib/domain/google-contract"

describe("complete Google Business Profile management contracts", () => {
  it("preflights Business Information writes", () => {
    const request = googleLocationPatchRequest({
      locationName: "locations/123",
      updateMask: ["categories", "serviceArea"],
      validateOnly: true,
      payload: { categories: {}, serviceArea: {} },
    })
    expect(request.url).toContain("updateMask=categories%2CserviceArea")
    expect(request.url).toContain("validateOnly=true")
    expect(JSON.parse(String(request.init.body)).name).toBe("locations/123")
  })

  it("uses the attribute mask deletion/update contract", () => {
    const request = googleLocationAttributesPatchRequest({
      locationName: "locations/123",
      attributeMask: ["attributes/a", "attributes/b"],
      attributes: [{ name: "attributes/a", values: [true] }],
    })
    expect(request.url).toContain("attributeMask=attributes%2Fa%2Cattributes%2Fb")
  })

  it("uses category and lifecycle endpoints", () => {
    expect(googleCategoriesRequest({ regionCode: "GB", languageCode: "en", query: "Hotel" }).url)
      .toContain("filter=displayName%3DHotel")
    expect(googleLocationCreateRequest({ accountName: "accounts/1", requestId: "request", validateOnly: true, payload: {} }).url)
      .toContain("accounts/1/locations")
  })

  it("uses verification and account-management endpoints", () => {
    expect(googleVerificationRequest({ path: "locations/1:verify", method: "POST", payload: { method: "EMAIL" } }).url)
      .toBe("https://mybusinessverifications.googleapis.com/v1/locations/1:verify")
    expect(googleAccountManagementRequest({ path: "locations/1/admins/2", method: "PATCH", updateMask: ["role"], payload: { role: "OWNER" } }).url)
      .toContain("updateMask=role")
  })

  it("uses direct binary media upload references", () => {
    expect(googleMediaStartUploadRequest({ accountName: "accounts/1", locationName: "locations/2" }).url)
      .toContain("media:startUpload")
    const request = googleMediaBinaryUploadRequest({ resourceName: "abc/123", bytes: new ArrayBuffer(2), contentType: "image/jpeg" })
    expect(request.url).toContain("upload/v1/media/abc%2F123")
    expect(request.init.headers).toEqual({ "content-type": "image/jpeg" })
  })

  it("uses lodging and healthcare service-list endpoints", () => {
    expect(googleLodgingRequest({ locationName: "locations/1", operation: "get" }).url)
      .toContain("mybusinesslodging.googleapis.com/v1/locations/1/lodging")
    expect(googleHealthcareRequest({ accountName: "accounts/1", locationName: "locations/2", resource: "serviceList" }).url)
      .toContain("mybusiness.googleapis.com/v4/accounts/1/locations/2/serviceList")
  })
})

describe("complete GBP management persistence", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/0026_complete_gbp_management_foundation.sql",
      import.meta.url
    ),
    "utf8"
  )

  it("persists snapshots and mutations with forced tenant isolation", () => {
    expect(migration).toContain("create table gbp_resource_snapshot")
    expect(migration).toContain("create table gbp_management_mutation")
    expect(migration).toContain("force row level security")
    expect(migration).toContain("gbp_management_mutation_expiry_idx")
  })

  it("stores the selected Google notification types", () => {
    expect(migration).toContain("add column notification_types text[]")
  })
})

describe("gbp_management_mutation.started_at (0069)", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/0069_gbp_management_started_at.sql",
      import.meta.url
    ),
    "utf8"
  )
  const retention = readFileSync(
    new URL("../app/api/cron/retention/route.ts", import.meta.url),
    "utf8"
  )

  it("adds a defaulted, non-null started_at and records itself", () => {
    expect(migration).toMatch(
      /alter table gbp_management_mutation\s+add column started_at timestamptz not null default now\(\)/
    )
    expect(migration).toContain("'0069_gbp_management_started_at'")
    expect(migration).not.toMatch(/\bupdate\s+gbp_management_mutation\b/)
  })

  it("ages stranded management attempts off started_at", () => {
    expect(retention).toMatch(
      /update gbp_management_mutation[\s\S]*?where status in \('started', 'validated'\)\s+and started_at <= now\(\) - interval '24 hours'/
    )
  })
})
