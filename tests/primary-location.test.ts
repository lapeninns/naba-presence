import { describe, expect, it } from "vitest"

import {
  comparePrimaryCandidates,
  pickPrimaryLocationId,
  type PrimaryCandidate,
} from "@/lib/locations/primary-location"

function candidate(
  id: string,
  name: string,
  linked = true
): PrimaryCandidate {
  return { id, name, linked }
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest]
    )
  )
}

describe("pickPrimaryLocationId", () => {
  it("returns null for an empty directory", () => {
    expect(pickPrimaryLocationId([])).toBeNull()
  })

  it("returns a lone unlinked location rather than nothing", () => {
    // An org whose only location was unlinked still has a business to show —
    // that is a different state from having no locations at all.
    expect(pickPrimaryLocationId([candidate("a", "Riverside", false)])).toBe("a")
  })

  it("prefers a linked location over an alphabetically earlier unlinked one", () => {
    // The unlink-regression guard. DELETE /api/location-links only sets
    // is_active = false, so the dead location's row survives; without `linked`
    // in the rule an owner would keep landing on it forever.
    const id = pickPrimaryLocationId([
      candidate("a", "Aardvark Cafe", false),
      candidate("b", "Zebra Bistro", true),
    ])
    expect(id).toBe("b")
  })

  it("falls back to case-folded alphabetical order within the same linked state", () => {
    expect(
      pickPrimaryLocationId([candidate("b", "banana"), candidate("a", "Apple")])
    ).toBe("a")
    expect(
      pickPrimaryLocationId([
        candidate("b", "banana", false),
        candidate("a", "Apple", false),
      ])
    ).toBe("a")
  })

  it("breaks a case-only name tie on id, ascending", () => {
    // `unique (organisation_id, name)` makes exact duplicates impossible, so
    // names differing only by case are the real tie the id tiebreaker exists
    // for.
    expect(
      pickPrimaryLocationId([candidate("b", "Cafe"), candidate("a", "cafe")])
    ).toBe("a")
  })

  it("returns the same id for every ordering of the same directory", () => {
    const set = [
      candidate("id-3", "Riverside", true),
      candidate("id-1", "Aardvark Cafe", false),
      candidate("id-4", "riverside", true),
      candidate("id-2", "Zebra Bistro", false),
      candidate("id-5", "Old Town", true),
    ]
    const answers = new Set(
      permutations(set).map((order) => pickPrimaryLocationId(order))
    )
    // Exactly one answer across all 120 orderings is the property under test;
    // "Old Town" is that answer because it case-folds ahead of both
    // "Riverside" spellings among the linked candidates.
    expect(answers.size).toBe(1)
    expect(answers).toEqual(new Set(["id-5"]))
  })

  it("does not mutate the array it is given", () => {
    // Callers pass the React Query cache entry, which also backs the
    // /locations table's display order — an in-place sort here would silently
    // reorder that table.
    const input = [
      candidate("b", "Zebra"),
      candidate("a", "Aardvark"),
      candidate("c", "Middle"),
    ]
    const snapshot = structuredClone(input)
    pickPrimaryLocationId(input)
    expect(input).toEqual(snapshot)
  })

  it("orders non-ASCII names by JS code unit, not database collation", () => {
    // Executable record of why the sort is in TypeScript. Postgres under an
    // ICU collation puts "Éclair" first (linguistic ordering); JS compares
    // UTF-16 code units, so "Zebra" (Z = U+005A) precedes "Éclair"
    // (É = U+00C9). If resolution ever read SQL's ordering on one side and
    // this comparator on the other, the two would pick different businesses.
    expect(
      pickPrimaryLocationId([candidate("e", "Éclair"), candidate("z", "Zebra")])
    ).toBe("z")
  })
})

describe("comparePrimaryCandidates", () => {
  const fixture = [
    candidate("id-1", "Aardvark", false),
    candidate("id-2", "Zebra", true),
    candidate("id-3", "aardvark", true),
    candidate("id-4", "Éclair", false),
    candidate("id-5", "Zebra", true),
  ]

  it("is antisymmetric", () => {
    for (const a of fixture) {
      for (const b of fixture) {
        // Summed rather than negated-and-compared: Math.sign(0) is 0 while
        // -Math.sign(0) is -0, and toBe uses Object.is, which tells those
        // apart.
        expect(
          Math.sign(comparePrimaryCandidates(a, b)) +
            Math.sign(comparePrimaryCandidates(b, a))
        ).toBe(0)
      }
    }
  })

  it("is transitive", () => {
    for (const a of fixture) {
      for (const b of fixture) {
        for (const c of fixture) {
          if (
            comparePrimaryCandidates(a, b) < 0 &&
            comparePrimaryCandidates(b, c) < 0
          ) {
            expect(comparePrimaryCandidates(a, c)).toBeLessThan(0)
          }
        }
      }
    }
  })
})
