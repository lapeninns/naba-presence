import { execFileSync, spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  CONTRACT_MARKER,
  DEFAULT_LOCK_TIMEOUT,
  LOCK_TIMEOUT_MARKER,
  NO_TRANSACTION_MARKER,
  contractOperations,
  contractReason,
  migrationLockTimeout,
} from "../scripts/migration-rules.mjs"

const policyScript = fileURLToPath(
  new URL("../scripts/ci/migration-policy.mjs", import.meta.url)
)

const operations = (text: string) =>
  contractOperations(text).map(({ operation }) => operation)

describe("migration lock_timeout", () => {
  const transactional = { transactional: true }

  it("defaults transactional files to the default lock timeout", () => {
    expect(DEFAULT_LOCK_TIMEOUT).toBe("5s")
    expect(
      migrationLockTimeout(
        "0200_a.sql",
        "create table t (id int);\n",
        transactional
      )
    ).toBe("5s")
  })

  it("takes the fallback (MIGRATION_LOCK_TIMEOUT) over the default", () => {
    expect(
      migrationLockTimeout("0200_a.sql", "select 1;\n", {
        transactional: true,
        fallback: "30s",
      })
    ).toBe("30s")
  })

  it("lets a header override the fallback, and 0 turn it off", () => {
    const header = (value: string) =>
      `-- why this file needs longer\n${LOCK_TIMEOUT_MARKER} ${value}\n\nselect 1;\n`
    expect(
      migrationLockTimeout("0200_a.sql", header("1min"), transactional)
    ).toBe("1min")
    expect(migrationLockTimeout("0200_a.sql", header("0"), transactional)).toBe(
      null
    )
  })

  it("reads the header only before the first statement", () => {
    const text = `select 1;\n${LOCK_TIMEOUT_MARKER} 1min\n`
    expect(migrationLockTimeout("0200_a.sql", text, transactional)).toBe("5s")
  })

  it("sets none on a no-transaction file unless its header asks", () => {
    const text = `${NO_TRANSACTION_MARKER}\ncreate index concurrently i on t (id);\n`
    expect(
      migrationLockTimeout("0200_a.sql", text, { transactional: false })
    ).toBe(null)
    expect(
      migrationLockTimeout(
        "0200_a.sql",
        `${NO_TRANSACTION_MARKER}\n${LOCK_TIMEOUT_MARKER} 2s\ncreate index concurrently i on t (id);\n`,
        { transactional: false }
      )
    ).toBe("2s")
  })

  it("refuses a value that is not 0 or an integer with a unit", () => {
    for (const value of ["5 s", "5s'; drop table x; --", "-1", "abc", "1h"]) {
      expect(() =>
        migrationLockTimeout(
          "0200_a.sql",
          `${LOCK_TIMEOUT_MARKER} ${value}\nselect 1;\n`,
          transactional
        )
      ).toThrow(/0200_a.sql: lock timeout/)
    }
    expect(() =>
      migrationLockTimeout("MIGRATION_LOCK_TIMEOUT", "", {
        transactional: true,
        fallback: "soon",
      })
    ).toThrow(/MIGRATION_LOCK_TIMEOUT: lock timeout "soon"/)
  })
})

describe("expand/contract rule (contractOperations)", () => {
  it("flags each contract or table-locking operation on an existing table", () => {
    const text = [
      "drop table if exists old_thing;",
      "alter table review drop column legacy;",
      "alter table review drop legacy_two;",
      "alter table review rename column a to b;",
      "alter table review rename to reviews;",
      "alter table review alter column body set not null;",
      "alter table review alter column body type text;",
      "alter table review alter column seq drop default;",
      "alter table review add column must int not null;",
      "create index review_body_idx on review (body);",
      "create unique index on public.review (id);",
    ].join("\n")
    expect(contractOperations(text)).toEqual([
      { line: 1, operation: "drop table" },
      { line: 2, operation: "drop column on review" },
      { line: 3, operation: "drop column on review" },
      { line: 4, operation: "rename on review" },
      { line: 5, operation: "rename on review" },
      { line: 6, operation: "set not null on review" },
      { line: 7, operation: "alter column type on review" },
      { line: 8, operation: "drop default on review" },
      { line: 9, operation: "add not null column without default on review" },
      { line: 10, operation: "create index without concurrently on review" },
      { line: 11, operation: "create index without concurrently on review" },
    ])
  })

  it("checks every action of a multi-action alter table", () => {
    expect(
      operations(
        "alter table public.bulk_listing_child\n  alter column item_key set not null,\n  add column x int check (x in (1, 2)),\n  alter column seq drop default;"
      )
    ).toEqual([
      "set not null on bulk_listing_child",
      "drop default on bulk_listing_child",
    ])
  })

  it("allows expand-only changes", () => {
    const text = [
      "alter table review add column note text;",
      "alter table review add column flag boolean not null default false;",
      "alter table review add column total int generated always as (1) stored;",
      "alter table review add constraint review_note_len check (length(note) < 10) not valid;",
      "alter table review drop constraint if exists review_old_check;",
      "alter table review alter column note drop not null;",
      "alter table review alter column note set default 'x';",
      "create index concurrently if not exists review_note_idx on review (note);",
      "drop index if exists review_old_idx;",
      "drop function if exists old_fn();",
    ].join("\n")
    expect(contractOperations(text)).toEqual([])
  })

  it("does not flag changes to a table the same file creates", () => {
    const text = [
      'create table if not exists public."batch" (id int, seq int default 1);',
      "create index batch_seq_idx on batch (seq);",
      "alter table batch alter column seq set not null;",
      "alter table batch alter column seq drop default;",
      "alter table batch add column must int not null;",
    ].join("\n")
    expect(contractOperations(text)).toEqual([])
    // Drops and renames still count: they are never part of an expand.
    expect(
      operations("create table t (id int);\nalter table t rename to u;\n")
    ).toEqual(["rename on t"])
  })

  it("ignores DDL inside comments, strings and function bodies", () => {
    const text = [
      "-- alter table review drop column legacy;",
      "/* drop table review; */",
      "select 'alter table review rename to x;';",
      "create function f() returns void language plpgsql as $$",
      "begin",
      "  execute 'drop table review';",
      "  alter table review drop column x;",
      "end;",
      "$$;",
    ].join("\n")
    expect(contractOperations(text)).toEqual([])
  })

  it("reads quoted identifiers", () => {
    expect(
      operations('alter table "Review" alter column "Body" set not null;')
    ).toEqual(["set not null on review"])
  })

  it("flags 0126, which combined expand and contract in one file (audit W7-5)", () => {
    const text = readFileSync(
      new URL(
        "../supabase/migrations/0126_bulk_multi_item_batches.sql",
        import.meta.url
      ),
      "utf8"
    )
    expect(operations(text)).toEqual(
      expect.arrayContaining([
        "set not null on bulk_listing_operation",
        "set not null on bulk_listing_child",
        "drop default on bulk_listing_child",
      ])
    )
  })

  it("needs a reason in the header to accept a contract migration", () => {
    expect(
      contractReason(
        `${CONTRACT_MARKER} drop review.legacy, unused since 0140\nselect 1;\n`
      )
    ).toBe("drop review.legacy, unused since 0140")
    expect(contractReason(`${CONTRACT_MARKER}\nselect 1;\n`)).toBe(null)
    expect(contractReason(`select 1;\n${CONTRACT_MARKER} late\n`)).toBe(null)
    expect(
      contractReason(`${NO_TRANSACTION_MARKER}\n${CONTRACT_MARKER} big table\n`)
    ).toBe("big table")
  })
})

describe("migration-policy.mjs applies the rule to new migrations", () => {
  let repo: string | null = null

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo!, stdio: "pipe", encoding: "utf8" })

  const base = {
    // Historical files are not re-judged, even when they break the rule.
    "0001_init.sql":
      "create table review (id int, legacy text);\nalter table review rename to review2;\n",
  }

  // One repository with the historical migrations on main, built once: each
  // case then starts a fresh branch from main, so cases stay independent
  // without paying for a new repository (nine processes) each time.
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "naba-migration-policy-"))
    mkdirSync(join(repo, "supabase/migrations"), { recursive: true })
    git("init", "--quiet", "--initial-branch=main")
    git("config", "user.email", "test@example.invalid")
    git("config", "user.name", "test")
    for (const [name, text] of Object.entries(base)) {
      writeFileSync(join(repo, "supabase/migrations", name), text)
    }
    git("add", ".")
    git("commit", "--quiet", "-m", "base")
  })

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true })
    repo = null
  })

  /** A new change branch from main, with nothing left from another case. */
  function setup(existing: typeof base) {
    expect(existing).toBe(base)
    git("switch", "--quiet", "--force", "-C", "change", "main")
    git("clean", "--quiet", "-fdx")
  }

  function add(name: string, text: string) {
    writeFileSync(join(repo!, "supabase/migrations", name), text)
    git("add", ".")
    git("commit", "--quiet", "-m", name)
  }

  const policy = () => {
    const result = spawnSync(process.execPath, [policyScript, "main"], {
      cwd: repo!,
      encoding: "utf8",
    })
    return { code: result.status, output: result.stdout + result.stderr }
  }

  it("passes an expand-only migration", () => {
    setup(base)
    add("0002_note.sql", "alter table review add column note text;\n")
    const { code, output } = policy()
    expect(output).toContain("migration-policy: ok")
    expect(code).toBe(0)
  })

  it("fails a contract operation without the header", () => {
    setup(base)
    add("0002_drop.sql", "alter table review drop column legacy;\n")
    const { code, output } = policy()
    expect(code).toBe(1)
    expect(output).toContain(
      "0002_drop.sql:1: drop column on review is a contract or table-locking change"
    )
  })

  it("passes a contract operation that declares itself", () => {
    setup(base)
    add(
      "0002_drop.sql",
      `${CONTRACT_MARKER} legacy unused since 0001\nalter table review drop column legacy;\n`
    )
    const { code, output } = policy()
    expect(output).toContain(
      "0002_drop.sql is a contract migration: legacy unused since 0001"
    )
    expect(code).toBe(0)
  })

  it("fails an invalid lock-timeout header", () => {
    setup(base)
    add("0002_slow.sql", `${LOCK_TIMEOUT_MARKER} forever\nselect 1;\n`)
    const { code, output } = policy()
    expect(code).toBe(1)
    expect(output).toContain('0002_slow.sql: lock timeout "forever"')
  })
})
