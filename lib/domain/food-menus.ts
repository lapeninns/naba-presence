// Server-only (imports node:crypto). The client-safe vocabulary and counter
// live in lib/domain/food-menus-vocabulary.ts and are re-exported here so
// existing imports keep working.
import { createHash } from "node:crypto"

import {
  MENU_CHILD_KEY,
  MENU_PARENT_KIND,
  type BulkFoodMenusInput,
  type MenuChangePreview,
  type MenuNodeKind,
  type MenuNodeSummary,
} from "@/lib/domain/bulk-menus"

export * from "@/lib/domain/food-menus-vocabulary"

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    )
  }
  return value
}

export function hashFoodMenus(menus: Array<Record<string, unknown>>) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(menus)))
    .digest("hex")
}

// ---------------------------------------------------------------------------
// Stable menu node IDs and the bulk menu change (P09-R6)
// ---------------------------------------------------------------------------

type MenuNode = Record<string, unknown>

const isNode = (value: unknown): value is MenuNode =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))
const nodes = (value: unknown): MenuNode[] =>
  Array.isArray(value) ? value.filter(isNode) : []

/** The node's own content: its fields without its child nodes. */
function ownContent(kind: MenuNodeKind, node: MenuNode): MenuNode {
  const childKey = MENU_CHILD_KEY[kind]
  if (!childKey) return node
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [childKey]: children, ...own } = node
  return own
}

/**
 * A menu node's stable ID: the hash of its kind, its own content and its
 * parent's ID. The same node (same content, under the same menu and
 * section) has the same ID at every listing that holds it; a node whose
 * content or place differs is a different node, whatever it is called.
 */
export function menuNodeId(
  kind: MenuNodeKind,
  node: MenuNode,
  parentId: string | null
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([kind, parentId ?? "", canonical(ownContent(kind, node))])
    )
    .digest("hex")
    .slice(0, 32)
}

export type MenuNodeRef = {
  id: string
  kind: MenuNodeKind
  parentId: string | null
  /** Indexes from the menus list down to the node. */
  path: number[]
  node: MenuNode
  within: string[]
}

const firstLabel = (node: MenuNode) => {
  const label = Array.isArray(node.labels) ? node.labels[0] : undefined
  return isNode(label) && typeof label.displayName === "string"
    ? label.displayName
    : ""
}

/** Every addressable node of a listing's menus, outermost first, with its ID. */
export function menuNodes(menus: readonly MenuNode[]): MenuNodeRef[] {
  const out: MenuNodeRef[] = []
  const walk = (
    kind: MenuNodeKind,
    list: MenuNode[],
    parentId: string | null,
    path: number[],
    within: string[]
  ) => {
    list.forEach((node, index) => {
      const id = menuNodeId(kind, node, parentId)
      const here = [...path, index]
      out.push({ id, kind, parentId, path: here, node, within })
      const childKey = MENU_CHILD_KEY[kind]
      const childKind =
        kind === "menu" ? "section" : kind === "section" ? "item" : null
      if (childKey && childKind)
        walk(childKind, nodes(node[childKey]), id, here, [
          ...within,
          firstLabel(node),
        ])
    })
  }
  walk("menu", [...menus], null, [], [])
  return out
}

const descendants = (ref: MenuNodeRef, all: readonly MenuNodeRef[]) =>
  all.filter(
    (other) =>
      other.path.length > ref.path.length &&
      ref.path.every((step, index) => other.path[index] === step)
  ).length

function summary(ref: MenuNodeRef, all: readonly MenuNodeRef[]) {
  return {
    id: ref.id,
    kind: ref.kind,
    label: firstLabel(ref.node),
    within: ref.within,
    contains: descendants(ref, all),
  }
}

/** The outermost nodes of `refs` (a node whose parent is also listed is left out). */
const outermost = (refs: MenuNodeRef[]) => {
  const ids = new Set(refs.map((ref) => ref.id))
  return refs.filter((ref) => !ref.parentId || !ids.has(ref.parentId))
}

export type MenuChangeResult =
  | {
      ok: true
      menus: MenuNode[]
      preview: MenuChangePreview
    }
  | {
      ok: false
      /** menu_node_not_found | menu_node_ambiguous | menu_parent_mismatch | menu_changes_overlap */
      reason: string
      nodeIds: string[]
    }

function counts(menus: readonly MenuNode[]) {
  const all = menuNodes(menus)
  return {
    menus: all.filter((ref) => ref.kind === "menu").length,
    sections: all.filter((ref) => ref.kind === "section").length,
    items: all.filter((ref) => ref.kind === "item").length,
  }
}

/**
 * What a bulk menu change makes one listing's menus, and what it removes,
 * adds and updates there (for the approver). Nodes are found by stable ID
 * only. A `replace` lists every node of the listing that is not in the
 * replacement (by ID: a node that moved or changed counts as removed and
 * added). A `merge` maps each named ID to exactly one node of the listing,
 * or skips the listing; its changes apply together against the menus as
 * read, so none depends on another's result.
 */
export function applyMenuChange(
  input: BulkFoodMenusInput,
  current: readonly MenuNode[]
): MenuChangeResult {
  const before = menuNodes(current)
  if (input.mode === "replace") {
    const menus = structuredClone(input.menus ?? []) as MenuNode[]
    const after = menuNodes(menus)
    const kept = new Set(after.map((ref) => ref.id))
    const had = new Set(before.map((ref) => ref.id))
    return {
      ok: true,
      menus,
      preview: {
        menusHash: hashFoodMenus(menus),
        removed: outermost(before.filter((ref) => !kept.has(ref.id))).map(
          (ref) => summary(ref, before)
        ),
        added: outermost(after.filter((ref) => !had.has(ref.id))).map((ref) =>
          summary(ref, after)
        ),
        updated: [],
        counts: counts(menus),
      },
    }
  }
  const changes = input.changes ?? []
  const byId = new Map<string, MenuNodeRef[]>()
  for (const ref of before) byId.set(ref.id, [...(byId.get(ref.id) ?? []), ref])
  const named = changes.flatMap((change) =>
    change.action === "add"
      ? change.parentId
        ? [change.parentId]
        : []
      : [change.nodeId]
  )
  const missing = named.filter((id) => !byId.has(id))
  if (missing.length)
    return { ok: false, reason: "menu_node_not_found", nodeIds: missing }
  const repeated = named.filter((id) => (byId.get(id)?.length ?? 0) > 1)
  if (repeated.length)
    return { ok: false, reason: "menu_node_ambiguous", nodeIds: repeated }
  const refOf = (id: string) => byId.get(id)![0]
  const wrongParent = changes.flatMap((change) =>
    change.action === "add" &&
    change.parentId &&
    refOf(change.parentId).kind !== MENU_PARENT_KIND[change.kind]
      ? [change.parentId]
      : []
  )
  if (wrongParent.length)
    return { ok: false, reason: "menu_parent_mismatch", nodeIds: wrongParent }
  // Nothing under a removed node may be changed or added to: the change
  // would be lost with it.
  const removed = changes.flatMap((change) =>
    change.action === "remove" ? [refOf(change.nodeId)] : []
  )
  const removedIds = new Set(removed.map((ref) => ref.id))
  const under = (ref: MenuNodeRef, outer: MenuNodeRef) =>
    ref.path.length > outer.path.length &&
    outer.path.every((step, index) => ref.path[index] === step)
  const overlaps = [
    ...named.filter((id) => removed.some((outer) => under(refOf(id), outer))),
    ...changes.flatMap((change) =>
      change.action === "add" &&
      change.parentId &&
      removedIds.has(change.parentId)
        ? [change.parentId]
        : []
    ),
  ]
  if (overlaps.length)
    return {
      ok: false,
      reason: "menu_changes_overlap",
      nodeIds: [...new Set(overlaps)],
    }

  const menus = structuredClone([...current]) as MenuNode[]
  const at = (path: number[]): MenuNode => {
    let list: MenuNode[] = menus
    let node: MenuNode = list[path[0]]
    let kind: MenuNodeKind = "menu"
    for (const index of path.slice(1)) {
      const key = MENU_CHILD_KEY[kind]!
      list = nodes(node[key])
      node = list[index]
      kind = kind === "menu" ? "section" : "item"
    }
    return node
  }
  const updated: Array<MenuNodeSummary & { fields: string[] }> = []
  // Updates first (paths are unchanged), then appends (they never shift an
  // existing index), then removals from the deepest, last index up.
  for (const change of changes) {
    if (change.action !== "update") continue
    const ref = refOf(change.nodeId)
    const node = at(ref.path)
    for (const [field, value] of Object.entries(change.fields)) {
      if (value === null) delete node[field]
      else node[field] = structuredClone(value)
    }
    updated.push({
      ...summary(ref, before),
      label: firstLabel(node) || firstLabel(ref.node),
      fields: Object.keys(change.fields).sort(),
    })
  }
  const appended: MenuNode[] = []
  for (const change of changes) {
    if (change.action !== "add") continue
    const node = structuredClone(change.node)
    appended.push(node)
    if (change.parentId === null) menus.push(node)
    else {
      const parent = refOf(change.parentId)
      const key = MENU_CHILD_KEY[parent.kind]!
      const holder = at(parent.path)
      holder[key] = [...nodes(holder[key]), node]
    }
  }
  const removing = [...removed].sort((left, right) => {
    for (
      let index = 0;
      index < Math.max(left.path.length, right.path.length);
      index += 1
    ) {
      const a = left.path[index] ?? -1
      const b = right.path[index] ?? -1
      if (a !== b) return b - a
    }
    return 0
  })
  for (const ref of removing) {
    const index = ref.path[ref.path.length - 1]
    if (ref.path.length === 1) menus.splice(index, 1)
    else {
      // By path, never by the parent's ID: two parents may share one.
      const holder = at(ref.path.slice(0, -1))
      const key = MENU_CHILD_KEY[MENU_PARENT_KIND[ref.kind]!]!
      const list = nodes(holder[key])
      list.splice(index, 1)
      holder[key] = list
    }
  }
  // An added node is described as it sits in the result (its ID there
  // reflects any update to its parent).
  const after = menuNodes(menus)
  const added = appended.flatMap((node) => {
    const ref = after.find((entry) => entry.node === node)
    return ref ? [summary(ref, after)] : []
  })
  return {
    ok: true,
    menus,
    preview: {
      menusHash: hashFoodMenus(menus),
      removed: removed.map((ref) => summary(ref, before)),
      added,
      updated,
      counts: counts(menus),
    },
  }
}
