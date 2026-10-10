import discovery from "@/lib/domain/google-lodging-schema.json"

type Node = {
  readonly type?: string; readonly $ref?: string; readonly readOnly?: boolean
  readonly enum?: readonly string[]; readonly format?: string
  readonly properties?: Readonly<Record<string, Node>>; readonly items?: Node
}
type Base = { readonly key: string; readonly path: string; readonly label: string; readonly updatePath: string }
export type LodgingEditorNode = Base & (
  | { readonly kind: "boolean" | "integer" | "number" | "text" }
  /** A google.type.TimeOfDay edited as one HH:MM value; the node's path addresses the whole object. */
  | { readonly kind: "time" }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "group"; readonly children: readonly LodgingEditorNode[] }
  | { readonly kind: "array"; readonly item: LodgingEditorNode }
)
const schemas: Readonly<Record<string, Node>> = discovery.schemas
export const LODGING_EDITOR_EXCLUSIONS: Readonly<Record<string, string>> = {
  name: "The authorised linked location supplies resource identity.",
  allUnits: "Google marks the aggregate read-only; edit individual guest unit types.",
  someUnits: "Google marks the aggregate read-only; edit individual guest unit types.",
  metadata: "The backend supplies review metadata; this is not a property detail.",
  "metadata.updateTime": "The backend supplies the timestamp when it freezes a review.",
}

// Schema keys are camelCase or SCREAMING_CASE; these words would otherwise
// read as machine output ("Ada", "Inunit", "Tv", "Mobile nfc").
const WORDS: Readonly<Record<string, string>> = {
  ada: "ADA", tv: "TV", nfc: "NFC", wifi: "Wi-Fi", inunit: "in-unit", checkin: "check-in",
  breeam: "BREEAM", leed: "LEED", iso14001: "ISO 14001", iso50001: "ISO 50001", sq: "square", meters: "metres",
}

export function lodgingFieldLabel(key: string) {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase()
    .split(" ").filter(Boolean).map((word) => WORDS[word] ?? word).join(" ")
    .replace(/\btwenty four hour\b/g, "24-hour")
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** Plain guidance for details Google requires or constrains, keyed by catalogue path. */
export const LODGING_FIELD_GUIDANCE: Readonly<Record<string, { readonly hint: string; readonly missing: string }>> = {
  "guestUnits[].codes": {
    hint: "Required. Add the room or unit codes for this type, such as the codes your booking system uses. Each code must be unique.",
    missing: "Add at least one room or unit code for this guest unit type.",
  },
  "guestUnits[].codes[]": {
    hint: "A room or unit code, such as DLXK.",
    missing: "Enter a room or unit code, or remove this empty code.",
  },
  "guestUnits[].label": {
    hint: "Required. A short name guests will recognise, such as Deluxe king room.",
    missing: "Enter a short name for this guest unit type, such as Deluxe king room.",
  },
  "services.languagesSpoken[].languageCode": {
    hint: "Required. A language code such as en, fr or es.",
    missing: "Enter a language code such as en, fr or es.",
  },
}

/** Converts a draft or payload path ("guestUnits.0.codes") to its catalogue path ("guestUnits[].codes"). */
export function lodgingCataloguePath(path: string | readonly PropertyKey[]) {
  const parts = typeof path === "string" ? path.split(".") : path.map(String)
  return parts.reduce((result, part) => /^\d+$/.test(part) ? `${result}[]` : result ? `${result}.${part}` : part, "")
}

function editorNode(key: string, node: Node, path: string, updatePath: string): LodgingEditorNode {
  const resolved = node.$ref ? schemas[node.$ref] : node
  if (!resolved) throw new Error(`Missing pinned lodging schema at ${path}`)
  const base = { key, path, updatePath, label: lodgingFieldLabel(key) }
  if (node.$ref === "TimeOfDay") return { ...base, kind: "time" }
  if (resolved.type === "object") {
    const children = Object.entries(resolved.properties ?? {}).flatMap(([childKey, child]) => {
      const childPath = `${path}.${childKey}`
      if (child.readOnly || LODGING_EDITOR_EXCLUSIONS[childPath]) return []
      return [editorNode(childKey, child, childPath, childPath.includes("[]") ? updatePath : childPath)]
    })
    return { ...base, kind: "group", children }
  }
  if (resolved.type === "array") {
    if (!resolved.items) throw new Error(`Missing pinned lodging array item at ${path}`)
    return { ...base, kind: "array", item: editorNode("item", resolved.items, `${path}[]`, updatePath) }
  }
  if (resolved.enum) return { ...base, kind: "enum", values: resolved.enum }
  switch (resolved.type) {
    case "boolean": return { ...base, kind: "boolean" }
    case "integer": return { ...base, kind: "integer" }
    case "number": return { ...base, kind: "number" }
    case "string": return { ...base, kind: "text" }
    default: throw new Error(`Unsupported writable lodging control at ${path}`)
  }
}

export const LODGING_EDITOR_GROUPS: readonly LodgingEditorNode[] = Object.entries(schemas.Lodging.properties ?? {}).flatMap(([key, node]) => {
  if (node.readOnly || LODGING_EDITOR_EXCLUSIONS[key]) return []
  return [editorNode(key, node, key, key)]
})

export function lodgingEditorCoverage(nodes: readonly LodgingEditorNode[] = LODGING_EDITOR_GROUPS): ReadonlyMap<string, LodgingEditorNode> {
  const fields = new Map<string, LodgingEditorNode>()
  const visit = (node: LodgingEditorNode) => {
    fields.set(node.path, node)
    if (node.kind === "group") node.children.forEach(visit)
    if (node.kind === "array") visit(node.item)
  }
  nodes.forEach(visit)
  return fields
}
