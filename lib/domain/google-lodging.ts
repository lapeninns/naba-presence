import discovery from "./google-lodging-schema.json"

type SchemaNode = {
  readonly type?: string
  readonly $ref?: string
  readonly readOnly?: boolean
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly items?: SchemaNode
}

const schemas: Readonly<Record<string, SchemaNode>> = discovery.schemas

export const GOOGLE_LODGING_PROVENANCE = {
  source: discovery.source,
  revision: discovery.revision,
  documentationCheckedAt: discovery.documentationCheckedAt,
} as const

export const GOOGLE_LODGING_EXCLUDED_FIELDS = {
  name: "Resource identity is supplied from the authorised linked location.",
  allUnits: "Google marks this aggregate read-only.",
  someUnits: "Google marks this aggregate read-only.",
} as const

function writablePaths(node: SchemaNode, prefix: string): string[] {
  const resolved = node.$ref ? schemas[node.$ref] : node
  return Object.entries(resolved?.properties ?? {}).flatMap(([key, child]) => {
    if (child.readOnly || (!prefix && key in GOOGLE_LODGING_EXCLUDED_FIELDS)) return []
    const path = prefix ? `${prefix}.${key}` : key
    return [path, ...(child.type === "array" ? [] : writablePaths(child, path))]
  })
}

export const GOOGLE_LODGING_UPDATE_PATHS: ReadonlySet<string> = new Set(
  writablePaths(schemas.Lodging, "")
)
