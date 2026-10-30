import { readdirSync, readFileSync, writeFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { listMigrationVersions, maskSql } from "../scripts/migration-rules.mjs"

import {
  GRANDFATHERED_PENDING_DERIVED,
  RETENTION_INVENTORY,
  renderRetentionInventoryMarkdown,
  retentionDataset,
  type RetentionDataset,
} from "@/lib/server/retention/inventory"
import { retentionPurgeCatalog } from "@/lib/server/retention/purge"

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url)

/**
 * The tables a sequence of migrations leaves behind: every `create table`,
 * less every `drop table` and with every `alter table ... rename to`
 * applied, in migration order. Comments, strings and function bodies are
 * masked first (maskSql), so neither a comment that mentions a table nor a
 * function that creates a temporary one counts.
 */
function tablesLeftBy(texts: readonly string[]): Set<string> {
  const tables = new Set<string>()
  const name = String.raw`(?:public\.)?(\w+)`
  const statement = new RegExp(
    String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${name}` +
      String.raw`|\bdrop\s+table\s+(?:if\s+exists\s+)?${name}` +
      String.raw`|\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${name}\s+rename\s+to\s+(\w+)`,
    "gi"
  )
  for (const text of texts) {
    for (const match of maskSql(text).matchAll(statement)) {
      const [, created, dropped, renamedFrom, renamedTo] = match
      if (created) tables.add(created.toLowerCase())
      if (dropped) tables.delete(dropped.toLowerCase())
      if (renamedFrom && renamedTo) {
        tables.delete(renamedFrom.toLowerCase())
        tables.add(renamedTo.toLowerCase())
      }
    }
  }
  return tables
}

function schemaTables(): Set<string> {
  const versions = listMigrationVersions(readdirSync(migrationsDirectory))
  return tablesLeftBy(
    versions.map((version) =>
      readFileSync(new URL(`${version}.sql`, migrationsDirectory), "utf8")
    )
  )
}

const inventory: readonly RetentionDataset[] = RETENTION_INVENTORY
const catalog = retentionPurgeCatalog()

/** Tables retention deletes rows of, by statement, cascade or other deleter. */
function retentionDeleted(dataset: RetentionDataset): boolean {
  return (
    (dataset.steps ?? []).some(
      (key) => catalog.find((step) => step.key === key)?.kind === "delete"
    ) ||
    (dataset.cascadeFrom?.length ?? 0) > 0 ||
    dataset.handledBy !== undefined
  )
}

describe("tablesLeftBy", () => {
  it("follows creates, drops and renames in order, ignoring comments and bodies", () => {
    expect(
      [
        ...tablesLeftBy([
          "create table a (id int);\nCREATE TABLE IF NOT EXISTS public.b (id int);",
          "-- create table not_a_table (id int);\ncreate table c (id int);",
          "drop table if exists a;\nalter table c rename to d;",
          "create function f() returns void language plpgsql as $$ begin create temporary table t (id int); end $$;",
        ]),
      ].sort()
    ).toEqual(["b", "d"])
  })
})

describe("retention inventory", () => {
  it("classifies every table the migrations leave, and nothing else", () => {
    const tables = schemaTables()
    const classified = inventory.map((dataset) => dataset.table)
    // Main's PR #49 tables and the later waves' are all in the schema.
    for (const table of [
      "gbp_change_set",
      "post_publication_schedule",
      "post_publication_occurrence",
      "bulk_listing_operation",
      "bulk_listing_child",
      "google_onboarding_review",
      "notification_delivery_event",
      "mutation_operation",
      "mutation_approval_decision",
      "post_approval_decision",
      "abuse_rate_bucket",
      "ops_pause_control",
      "ops_pause_event",
      "organisation_feature",
      "retention_cycle",
      "retention_cycle_org",
    ]) {
      expect(tables, table).toContain(table)
    }
    const unclassified = [...tables].filter((table) => !retentionDataset(table))
    expect(
      unclassified,
      "add a row to lib/server/retention/inventory.ts for each new table"
    ).toEqual([])
    expect(classified.filter((table) => !tables.has(table))).toEqual([])
    expect(new Set(classified).size).toBe(classified.length)
  })

  it("lists every purge step under the table it acts on, and only those", () => {
    for (const step of catalog) {
      const dataset = retentionDataset(step.table)
      expect(dataset, step.key).toBeDefined()
      expect(dataset?.steps ?? [], `${step.table} lists ${step.key}`).toContain(
        step.key
      )
      // Deletes are destructive and answer to RETENTION_DELETES_ENABLED.
      expect(step.destructive, step.key).toBe(step.kind === "delete")
      if (step.kind === "delete") {
        expect(dataset?.deletes, step.key).toBe("gated")
      }
    }
    for (const dataset of inventory) {
      for (const key of dataset.steps ?? []) {
        expect(
          catalog.find((step) => step.key === key)?.table,
          `${dataset.table} step ${key}`
        ).toBe(dataset.table)
      }
    }
  })

  it("backs every action with a mechanism and every mechanism with an action", () => {
    for (const dataset of inventory) {
      const kinds = (dataset.steps ?? []).map(
        (key) => catalog.find((step) => step.key === key)?.kind
      )
      switch (dataset.action) {
        case "redact":
          expect(kinds, dataset.table).toContain("redact")
          break
        case "delete":
          expect(retentionDeleted(dataset), dataset.table).toBe(true)
          break
        case "keep":
          expect(
            kinds.filter((kind) => kind !== "reap"),
            `${dataset.table} is kept, so no step retains it`
          ).toEqual([])
          expect(dataset.handledBy, dataset.table).toBeUndefined()
          break
      }
      expect(dataset.window.trim(), dataset.table).not.toBe("")
    }
  })

  it("derives cascades, the deletion switch and holds from the parents", () => {
    for (const dataset of inventory) {
      if (dataset.deletes === "none") {
        expect(retentionDeleted(dataset), dataset.table).toBe(false)
      } else {
        expect(retentionDeleted(dataset), dataset.table).toBe(true)
      }
      for (const parentTable of dataset.cascadeFrom ?? []) {
        const parent = retentionDataset(parentTable)
        expect(
          parent,
          `${dataset.table} cascades from ${parentTable}`
        ).toBeDefined()
        expect(retentionDeleted(parent!), parentTable).toBe(true)
        // A cascade answers to whatever switch its parent's delete does,
        // unless the dataset is already ungated: its own platform-level purge
        // (mfa_pending_login) deletes it whatever the switch says.
        if (dataset.deletes !== "ungated") {
          expect(dataset.deletes, `${dataset.table} via ${parentTable}`).toBe(
            parent!.deletes
          )
        }
        // A hold that stops the parent's delete stops the cascade from it.
        if (parent!.hold !== "none") {
          expect(dataset.hold, `${dataset.table} via ${parentTable}`).not.toBe(
            "none"
          )
        }
      }
      // Rows no step of their own touches go only by cascade, so a hold
      // that stops the cascade keeps them whole; `cascade` is for datasets
      // whose own window still runs.
      if (dataset.hold !== "none" && !(dataset.steps ?? []).length) {
        expect(dataset.hold, dataset.table).toBe("kept")
      }
    }
    expect(retentionDataset("review")?.hold).toBe("kept")
    expect(retentionDataset("audit_log")?.hold).toBe("kept")
    // Their own windows ignore holds (purge.ts carries no hold predicate on
    // these steps), so a hold only keeps them from the disconnect cascade.
    for (const table of [
      "external_location",
      "hours_sync_attempt",
      "profile_field_state",
      "gbp_local_post",
    ]) {
      expect(retentionDataset(table)?.hold, table).toBe("cascade")
    }
  })

  it("names an open decision and an interim keep decision for every pending window", () => {
    const decisionLog = readFileSync(
      new URL("../docs/release/decision-log.md", import.meta.url),
      "utf8"
    )
    for (const dataset of inventory) {
      if (dataset.approval.status !== "pending") continue
      expect(decisionLog, dataset.table).toContain(
        `| ${dataset.approval.decision} |`
      )
      expect(dataset.approval.interim.trim(), dataset.table).not.toBe("")
    }
  })

  it("deletes nothing a pending decision says to keep until decided (D-47)", () => {
    // A pending row answers to its decision's starting position in
    // decision-log.md. Where that is "Keep each until decided" (D-47), the
    // row is kept whole: no delete action and no destructive step of its own,
    // so turning RETENTION_DELETES_ENABLED on cannot purge it before the
    // decision. It may still go with a parent (cascadeFrom). A decision whose
    // position allows deletes (D-28: the privacy notice's windows) is not
    // held to this.
    const decisionLog = readFileSync(
      new URL("../docs/release/decision-log.md", import.meta.url),
      "utf8"
    )
    const position = (decision: string): string => {
      const line = decisionLog
        .split("\n")
        .find((row) => row.startsWith(`| ${decision} |`))
      return line?.split("|")[4]?.trim() ?? ""
    }
    expect(position("D-47")).toMatch(/^Keep each until decided/)
    let kept = 0
    for (const dataset of inventory) {
      if (dataset.approval.status !== "pending") continue
      if (!/^Keep\b/.test(position(dataset.approval.decision))) continue
      kept += 1
      expect(dataset.action, dataset.table).toBe("keep")
      expect(dataset.handledBy, dataset.table).toBeUndefined()
      const destructive = (dataset.steps ?? []).filter(
        (key) => catalog.find((step) => step.key === key)?.destructive
      )
      expect(destructive, dataset.table).toEqual([])
    }
    expect(kept).toBeGreaterThan(0)
    for (const table of [
      "post_publication_schedule",
      "post_publication_occurrence",
      "gbp_local_post_legacy_schedule",
    ]) {
      expect(retentionDataset(table)?.approval, table).toMatchObject({
        status: "pending",
        decision: "D-47",
      })
      expect(retentionDataset(table)?.action, table).toBe("keep")
    }
  })

  it("adds no derived dataset without an approved window", () => {
    // Stops new persistent derived aggregates while D-28 is open: a derived
    // dataset is either published in the privacy notice or one of the few
    // that predate the inventory, each with its interim keep decision.
    // review_topic joined the grandfathered list (lib/server/retention/
    // inventory.ts) by coordinator decision 2026-10-30, kept for the life of
    // the review, deleted with it; no review text stored.
    for (const dataset of inventory) {
      if (dataset.provenance !== "derived") continue
      if (dataset.approval.status === "published") continue
      expect(dataset.approval.status, dataset.table).toBe("pending")
      expect(GRANDFATHERED_PENDING_DERIVED, dataset.table).toContain(
        dataset.table
      )
    }
    for (const table of GRANDFATHERED_PENDING_DERIVED) {
      expect(retentionDataset(table)?.provenance, table).toBe("derived")
    }
    // S3 (coordinator decision 2026-10-30): the topic labels go with their
    // review and hold no text.
    expect(retentionDataset("review_topic")).toMatchObject({
      action: "keep",
      cascadeFrom: ["review"],
    })
  })

  it("is rendered into the runbook", () => {
    const runbookUrl = new URL("../docs/runbook.md", import.meta.url)
    const runbook = readFileSync(runbookUrl, "utf8")
    const start = "<!-- retention-inventory:start -->\n"
    const end = "\n<!-- retention-inventory:end -->"
    const from = runbook.indexOf(start)
    const to = runbook.indexOf(end)
    expect(from, "runbook retention-inventory markers").toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const rendered = renderRetentionInventoryMarkdown()
    if (process.env.UPDATE_RETENTION_INVENTORY === "1") {
      writeFileSync(
        runbookUrl,
        runbook.slice(0, from + start.length) + rendered + runbook.slice(to)
      )
      return
    }
    expect(
      runbook.slice(from + start.length, to),
      "run UPDATE_RETENTION_INVENTORY=1 pnpm exec vitest run tests/retention-inventory.test.ts"
    ).toBe(rendered)
  })
})
