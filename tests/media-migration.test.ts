import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { MEDIA_UPLOAD_PHASES } from "@/lib/domain/media-reconcile"

describe("Media migration", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/0019_media_management.sql"), "utf8")
  it("persists owner/customer media, attribution, and mutations", () => {
    expect(migration).toContain("create table gbp_media_item")
    expect(migration).toContain("ownership in ('merchant', 'customer')")
    expect(migration).toContain("attribution jsonb")
    expect(migration).toContain("create table gbp_media_mutation")
    expect(migration).toContain("gbp_media_mutation_expiry_idx")
  })
  it("forces tenant RLS", () => {
    expect(migration).toContain("alter table gbp_media_item force row level security")
    expect(migration).toContain("alter table gbp_media_mutation force row level security")
  })
})

describe("Media upload checkpoints migration (0093)", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0093_media_mutation_checkpoints.sql"),
    "utf8"
  )
  const sql = migration.replace(/--.*$/gm, "")

  it("adds the checkpoint, content and resolution columns", () => {
    expect(sql).toContain("add column started_at timestamptz not null default now()")
    expect(sql).toContain("add column upload_data_ref text")
    expect(sql).toContain("add column content_sha256 text")
    expect(sql).toMatch(/add column resolution text\s+check \(resolution is null or resolution in \('adopted', 'abandoned'\)\)/)
  })

  it("checks upload_phase against the phases lib/domain/media-reconcile.ts records", () => {
    const phases = MEDIA_UPLOAD_PHASES.map((phase) => `'${phase}'`).join(", ")
    expect(sql).toContain("add column upload_phase text not null default 'none'")
    expect(sql).toContain(`check (upload_phase in (${phases}))`)
  })

  it("widens the status CHECK to needs_resolution and keeps every earlier status", () => {
    expect(sql).toContain("drop constraint if exists gbp_media_mutation_status_check")
    expect(sql).toContain(
      "status in ('started', 'succeeded', 'failed', 'ambiguous', 'needs_resolution')"
    )
  })

  it("is expand-only and records itself", () => {
    expect(sql).not.toMatch(/\bdrop (table|column)\b/i)
    expect(sql).not.toMatch(/\bupdate gbp_media_mutation\b/i)
    expect(sql).toContain("('0093_media_mutation_checkpoints')")
  })
})
