/**
 * Bulk Food Menus and post drafts (P09-R6): the change one batch carries to
 * each listing. Client-safe and pure; the node identities and the merge
 * itself hash with node:crypto and live in lib/domain/food-menus.ts.
 *
 * Menus change in one of two ways, never by matching a label:
 *
 *   - `replace`: the listing's whole Food Menus become the given menus. The
 *     preview lists every node the listing loses.
 *   - `merge`: named nodes change by stable node ID (`menuNodeId`): a node's
 *     ID is the hash of its kind, its own content (its fields without its
 *     child nodes) and its parent's ID, as Google holds them when the
 *     preview reads the listing. A node is mapped at a listing only when
 *     exactly one node there has that ID; a missing or repeated ID skips
 *     the listing. Two nodes that merely share a name are different nodes.
 *
 * Posts: each listing gets its own, independent local draft. Nothing is
 * published by the batch; each draft is published (and, under two-person
 * approval, approved) separately from the listing's posts.
 */
import { z } from "zod"

import { localPostInputSchema } from "@/lib/contracts/location-posts"
import { foodMenuSchema } from "@/lib/contracts/location-food-menus"

/** The menu tree's addressable levels, outermost first. */
export const MENU_NODE_KINDS = ["menu", "section", "item"] as const
export type MenuNodeKind = (typeof MENU_NODE_KINDS)[number]
/** The child list of each level (an item's options are part of the item). */
export const MENU_CHILD_KEY = {
  menu: "sections",
  section: "items",
  item: null,
} as const satisfies Record<MenuNodeKind, string | null>
/** The level a node of each kind sits under (null: the menus list itself). */
export const MENU_PARENT_KIND = {
  menu: null,
  section: "menu",
  item: "section",
} as const satisfies Record<MenuNodeKind, MenuNodeKind | null>

/** 128 bits of a SHA-256, hex: what `menuNodeId` returns. */
export const menuNodeIdSchema = z
  .string()
  .regex(/^[a-f0-9]{32}$/, "Use a menu node ID from the listing's menus.")

const menuNode = z.record(z.string(), z.unknown())

/** One node change of a merge. */
export const bulkMenuNodeChangeSchema = z.discriminatedUnion("action", [
  /**
   * Sets the named fields of the node's own content; a null value removes
   * the field. Fields not named stay as the listing holds them, and the
   * node's child nodes are never touched (change them by their own IDs).
   */
  z.strictObject({
    action: z.literal("update"),
    nodeId: menuNodeIdSchema,
    fields: z
      .record(z.string().min(1).max(64), z.unknown())
      .refine(
        (fields) => Object.keys(fields).length > 0,
        "Name at least one field to change."
      ),
  }),
  /** Removes the node with everything under it; the preview lists it. */
  z.strictObject({ action: z.literal("remove"), nodeId: menuNodeIdSchema }),
  /**
   * Appends a node (with any child nodes it carries) to the end of its
   * parent's list: a menu to the listing's menus (no parent), a section to
   * a menu, an item to a section.
   */
  z
    .strictObject({
      action: z.literal("add"),
      kind: z.enum(MENU_NODE_KINDS),
      parentId: menuNodeIdSchema.nullable(),
      node: menuNode,
    })
    .refine((value) => (value.kind === "menu") === (value.parentId === null), {
      path: ["parentId"],
      message: "A menu has no parent; a section or item needs one.",
    }),
])
export type BulkMenuNodeChange = z.infer<typeof bulkMenuNodeChangeSchema>

export const bulkFoodMenusInputSchema = z
  .strictObject({
    operation: z.literal("food_menus"),
    mode: z.enum(["replace", "merge"]),
    /** `replace`: the listing's complete Food Menus afterwards. */
    menus: z.array(foodMenuSchema).max(100).optional(),
    /** `merge`: node changes by stable ID, applied together. */
    changes: z.array(bulkMenuNodeChangeSchema).min(1).max(200).optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === "replace" && value.menus === undefined)
      context.addIssue({
        code: "custom",
        path: ["menus"],
        message: "Give the menus that replace each listing's menus.",
      })
    if (value.mode === "replace" && value.changes !== undefined)
      context.addIssue({
        code: "custom",
        path: ["changes"],
        message: "A replacement gives whole menus, not node changes.",
      })
    if (value.mode === "merge" && value.changes === undefined)
      context.addIssue({
        code: "custom",
        path: ["changes"],
        message: "Give the node changes to merge.",
      })
    if (value.mode === "merge" && value.menus !== undefined)
      context.addIssue({
        code: "custom",
        path: ["menus"],
        message: "A merge gives node changes, not whole menus.",
      })
    const named = (value.changes ?? []).flatMap((change) =>
      change.action === "add" ? [] : [change.nodeId]
    )
    if (new Set(named).size !== named.length)
      context.addIssue({
        code: "custom",
        path: ["changes"],
        message: "Change each menu node once.",
      })
    for (const [index, change] of (value.changes ?? []).entries()) {
      if (change.action === "update" && "sections" in change.fields)
        context.addIssue({
          code: "custom",
          path: ["changes", index, "fields"],
          message:
            "Change a menu's sections by their own IDs, not as a field of the menu.",
        })
      if (change.action === "update" && "items" in change.fields)
        context.addIssue({
          code: "custom",
          path: ["changes", index, "fields"],
          message:
            "Change a section's items by their own IDs, not as a field of the section.",
        })
    }
  })
export type BulkFoodMenusInput = z.infer<typeof bulkFoodMenusInputSchema>

/** One independent local draft per listing; publication is a separate step. */
export const bulkPostDraftInputSchema = z.strictObject({
  operation: z.literal("post_draft"),
  post: localPostInputSchema,
})
export type BulkPostDraftInput = z.infer<typeof bulkPostDraftInputSchema>

/** A node the preview lists: what it is and where it sits, for the approver. */
export type MenuNodeSummary = {
  id: string
  kind: MenuNodeKind
  /** The node's first label, for display only; nodes are never matched by it. */
  label: string
  /** The labels of the menu and section it sits in. */
  within: string[]
  /** How many sections and items go with it. */
  contains: number
}

/** What a menus child changes at one listing (its frozen `proposedValue`). */
export type MenuChangePreview = {
  menusHash: string
  removed: MenuNodeSummary[]
  added: MenuNodeSummary[]
  updated: Array<MenuNodeSummary & { fields: string[] }>
  counts: { menus: number; sections: number; items: number }
}
