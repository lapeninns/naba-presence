import { describe, expect, it } from "vitest"

import { describeChildChange } from "@/components/bulk/bulk-change-summary"
import { bulkPreviewRequestSchema } from "@/lib/contracts/bulk-listings"
import type { BulkFoodMenusInput } from "@/lib/domain/bulk-menus"
import {
  bulkChangeListSchema,
  bulkChangeParts,
  bulkOperationInputSchema,
  bulkResourceKey,
} from "@/lib/domain/bulk-merge"
import {
  applyMenuChange,
  hashFoodMenus,
  menuNodeId,
  menuNodes,
} from "@/lib/domain/food-menus"
import { postDraftsFamily } from "@/lib/server/bulk-families/posts"

const label = (displayName: string) => [{ displayName }]
const item = (name: string, units = "5") => ({
  labels: label(name),
  attributes: { price: { currencyCode: "GBP", units } },
})
const lunch = () => [
  {
    labels: label("Lunch"),
    sections: [
      { labels: label("Starters"), items: [item("Soup"), item("Bread", "3")] },
      { labels: label("Mains"), items: [item("Pie", "14")] },
    ],
  },
]
const idOf = (menus: Array<Record<string, unknown>>, name: string) =>
  menuNodes(menus).find(
    (ref) =>
      (ref.node.labels as Array<{ displayName: string }>)[0]?.displayName ===
      name
  )!.id
const merge = (changes: unknown[]) =>
  bulkOperationInputSchema.parse({
    operation: "food_menus",
    mode: "merge",
    changes,
  }) as BulkFoodMenusInput
const replace = (menus: unknown[]) =>
  bulkOperationInputSchema.parse({
    operation: "food_menus",
    mode: "replace",
    menus,
  }) as BulkFoodMenusInput

describe("menu node IDs", () => {
  it("are stable across listings, scoped by parent, and ignore child nodes", () => {
    const a = lunch()
    const b = lunch()
    b[0].sections[0].items.push(item("Extra"))
    // The same section with different items keeps its ID: its own content
    // and place are the same.
    expect(idOf(a, "Starters")).toBe(idOf(b, "Starters"))
    expect(idOf(a, "Soup")).toBe(idOf(b, "Soup"))
    expect(idOf(a, "Soup")).toMatch(/^[a-f0-9]{32}$/)
    // The same item under another section is another node.
    const moved = lunch()
    moved[0].sections[1].items.push(item("Soup"))
    const soups = menuNodes(moved).filter(
      (ref) =>
        (ref.node.labels as Array<{ displayName: string }>)[0].displayName ===
        "Soup"
    )
    expect(new Set(soups.map((ref) => ref.id)).size).toBe(2)
  })

  it("never match by label: a renamed or repriced node is a different node", () => {
    const parent = menuNodeId("section", { labels: label("Starters") }, "x")
    expect(menuNodeId("item", item("Soup", "5"), parent)).not.toBe(
      menuNodeId("item", item("Soup", "6"), parent)
    )
    expect(menuNodeId("item", item("Soup"), parent)).not.toBe(
      menuNodeId("item", item("Soup "), parent)
    )
  })
})

describe("applyMenuChange", () => {
  it("replace lists every node the listing loses, outermost only", () => {
    const current = lunch()
    const next = lunch()
    next[0].sections.splice(1, 1) // Mains (with Pie) goes
    next[0].sections[0].items.push(item("Salad"))
    const result = applyMenuChange(replace(next), current)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.removed).toEqual([
      expect.objectContaining({
        kind: "section",
        label: "Mains",
        within: ["Lunch"],
        contains: 1,
      }),
    ])
    expect(result.preview.added).toEqual([
      expect.objectContaining({ kind: "item", label: "Salad" }),
    ])
    expect(result.preview.menusHash).toBe(hashFoodMenus(next))
    expect(result.preview.counts).toEqual({ menus: 1, sections: 1, items: 3 })
  })

  it("merge updates, adds and removes by ID and keeps everything else", () => {
    const current = lunch()
    const result = applyMenuChange(
      merge([
        {
          action: "update",
          nodeId: idOf(current, "Soup"),
          fields: {
            attributes: { price: { currencyCode: "GBP", units: "6" } },
          },
        },
        { action: "remove", nodeId: idOf(current, "Bread") },
        {
          action: "add",
          kind: "item",
          parentId: idOf(current, "Mains"),
          node: item("Fish", "15"),
        },
      ]),
      current
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.menus).toEqual([
      {
        labels: label("Lunch"),
        sections: [
          { labels: label("Starters"), items: [item("Soup", "6")] },
          {
            labels: label("Mains"),
            items: [item("Pie", "14"), item("Fish", "15")],
          },
        ],
      },
    ])
    expect(result.preview.removed).toEqual([
      expect.objectContaining({
        kind: "item",
        label: "Bread",
        within: ["Lunch", "Starters"],
      }),
    ])
    expect(result.preview.updated).toEqual([
      expect.objectContaining({ label: "Soup", fields: ["attributes"] }),
    ])
    expect(result.preview.added).toEqual([
      expect.objectContaining({ kind: "item", label: "Fish" }),
    ])
    // The input is untouched.
    expect(current).toEqual(lunch())
  })

  it("removes by path from the last index up and clears a field with null", () => {
    const current = lunch()
    const result = applyMenuChange(
      merge([
        { action: "remove", nodeId: idOf(current, "Soup") },
        { action: "remove", nodeId: idOf(current, "Bread") },
        {
          action: "update",
          nodeId: idOf(current, "Pie"),
          fields: { attributes: null },
        },
      ]),
      current
    )
    expect(result.ok && result.menus[0].sections).toEqual([
      { labels: label("Starters"), items: [] },
      { labels: label("Mains"), items: [{ labels: label("Pie") }] },
    ])
  })

  it("skips a listing whose named node is missing or repeated, never guessing by label", () => {
    const other = lunch()
    other[0].sections[0].items[0] = item("Soup", "7") // same name, other price
    expect(
      applyMenuChange(
        merge([{ action: "remove", nodeId: idOf(lunch(), "Soup") }]),
        other
      )
    ).toMatchObject({ ok: false, reason: "menu_node_not_found" })
    const twice = lunch()
    twice[0].sections[0].items.push(item("Soup"))
    expect(
      applyMenuChange(
        merge([{ action: "remove", nodeId: idOf(lunch(), "Soup") }]),
        twice
      )
    ).toMatchObject({ ok: false, reason: "menu_node_ambiguous" })
  })

  it("refuses changes inside a removed node and adds under the wrong level", () => {
    const current = lunch()
    expect(
      applyMenuChange(
        merge([
          { action: "remove", nodeId: idOf(current, "Starters") },
          {
            action: "update",
            nodeId: idOf(current, "Soup"),
            fields: { labels: label("Broth") },
          },
        ]),
        current
      )
    ).toMatchObject({ ok: false, reason: "menu_changes_overlap" })
    expect(
      applyMenuChange(
        merge([
          { action: "remove", nodeId: idOf(current, "Mains") },
          {
            action: "add",
            kind: "item",
            parentId: idOf(current, "Mains"),
            node: item("Fish"),
          },
        ]),
        current
      )
    ).toMatchObject({ ok: false, reason: "menu_changes_overlap" })
    expect(
      applyMenuChange(
        merge([
          {
            action: "add",
            kind: "item",
            parentId: idOf(current, "Lunch"),
            node: item("Fish"),
          },
        ]),
        current
      )
    ).toMatchObject({ ok: false, reason: "menu_parent_mismatch" })
  })
})

describe("bulk menus and post-draft inputs", () => {
  const id = "a".repeat(32)
  it("validates the menu modes and refuses child lists as fields", () => {
    const parse = (value: Record<string, unknown>) =>
      bulkOperationInputSchema.safeParse({ operation: "food_menus", ...value })
    expect(parse({ mode: "replace", menus: [] }).success).toBe(true)
    expect(parse({ mode: "replace" }).success).toBe(false)
    expect(
      parse({ mode: "merge", changes: [{ action: "remove", nodeId: id }] })
        .success
    ).toBe(true)
    expect(
      parse({
        mode: "merge",
        changes: [
          { action: "remove", nodeId: id },
          { action: "update", nodeId: id, fields: { labels: [] } },
        ],
      }).success
    ).toBe(false)
    expect(
      parse({
        mode: "merge",
        changes: [{ action: "update", nodeId: id, fields: { items: [] } }],
      }).success
    ).toBe(false)
    expect(
      parse({
        mode: "merge",
        changes: [{ action: "remove", nodeId: "Soup" }],
      }).success
    ).toBe(false)
    expect(
      parse({
        mode: "merge",
        changes: [{ action: "add", kind: "section", parentId: null, node: {} }],
      }).success
    ).toBe(false)
  })

  it("keys, parts and the change list", () => {
    const post = bulkOperationInputSchema.parse({
      operation: "post_draft",
      post: { topicType: "STANDARD", summary: "Quiz night" },
    })
    expect(post).toMatchObject({
      post: { languageCode: "en-GB", media: [] },
    })
    expect(bulkChangeParts(post)).toEqual([])
    expect(bulkResourceKey("post_draft")).toBe("posts")
    expect(bulkResourceKey("food_menus")).toBe("food_menus")
    // Several drafts in one batch are independent; two menu changes overlap.
    expect(bulkChangeListSchema.safeParse([post, post]).success).toBe(true)
    const menus = { operation: "food_menus", mode: "replace", menus: [] }
    expect(bulkChangeListSchema.safeParse([menus, menus]).success).toBe(false)
    expect(
      bulkPreviewRequestSchema.safeParse({
        locationIds: ["00000000-0000-4000-8000-000000000001"],
        items: [menus, post],
      }).success
    ).toBe(true)
    // An event post still needs its event.
    expect(
      bulkOperationInputSchema.safeParse({
        operation: "post_draft",
        post: { topicType: "EVENT", summary: "x" },
      }).success
    ).toBe(false)
  })

  it("plans a draft for every listing and sends nothing to Google", async () => {
    expect(postDraftsFamily.writeSurface).toBeNull()
    const plan = await postDraftsFamily.plan(
      {
        operation: "post_draft",
        post: {
          topicType: "STANDARD",
          languageCode: "en-GB",
          summary: "Quiz night",
          media: [],
        },
      },
      {} as never,
      {} as never
    )
    expect(plan).toEqual({
      eligible: true,
      current: null,
      proposed: {
        topicType: "STANDARD",
        languageCode: "en-GB",
        summary: "Quiz night",
      },
      updateMask: ["localPost"],
    })
    expect(
      postDraftsFamily.reconcile({
        state: "uncertain",
        errorCode: null,
        attemptStatus: null,
      })
    ).toBeNull()
  })
})

describe("approver summary", () => {
  it("lists each menu removal as its own row", () => {
    const current = lunch()
    const result = applyMenuChange(
      merge([
        { action: "remove", nodeId: idOf(current, "Bread") },
        { action: "remove", nodeId: idOf(current, "Mains") },
      ]),
      current
    )
    if (!result.ok) throw new Error("expected ok")
    const rows = describeChildChange({
      operation: "food_menus",
      input: merge([{ action: "remove", nodeId: idOf(current, "Bread") }]),
      currentValue: {
        googleHash: "x",
        counts: { menus: 1, sections: 2, items: 3 },
      },
      proposedValue: result.preview,
      updateMask: ["menus"],
    })
    expect(rows).toEqual([
      {
        label: "Removed",
        current: "Item “Bread” in Lunch › Starters",
        proposed: "Removed from Google",
      },
      {
        label: "Removed",
        current: "Section “Mains” in Lunch (with 1 entry inside)",
        proposed: "Removed from Google",
      },
      {
        label: "Menus",
        current: "1 menus, 2 sections, 3 items",
        proposed: "1 menus, 1 sections, 1 items",
      },
    ])
  })

  it("describes a post draft", () => {
    expect(
      describeChildChange({
        operation: "post_draft",
        input: bulkOperationInputSchema.parse({
          operation: "post_draft",
          post: { topicType: "STANDARD", summary: "Quiz night" },
        }),
        currentValue: null,
        proposedValue: { topicType: "STANDARD", summary: "Quiz night" },
        updateMask: ["localPost"],
      })
    ).toEqual([
      {
        label: "New post draft",
        current: "Nothing published",
        proposed: "Update draft: Quiz night",
      },
    ])
  })
})
