import { z } from "zod"

export const googleAttributeNameSchema = z.string().regex(/^attributes\/[^\s/,]+$/, "Use a Google attribute resource name.")
const enumAnswers = z.array(z.string().min(1)).refine((values) => new Set(values).size === values.length, "Attribute answers must be unique.")
export const googleAttributeWriteSchema = z.object({
  name: googleAttributeNameSchema,
  values: z.array(z.union([z.boolean(), z.string(), z.number()])).length(1).optional(),
  uriValues: z.array(z.object({ uri: z.url(), uriType: z.string().optional() }).strict()).min(1).optional(),
  repeatedEnumValue: z.object({ setValues: enumAnswers.optional(), unsetValues: enumAnswers.optional() }).strict().superRefine((value, context) => {
    const selected = value.setValues ?? []
    const unselected = value.unsetValues ?? []
    if (selected.length + unselected.length === 0) context.addIssue({ code: "custom", message: "Choose at least one attribute answer." })
    if (selected.some((item) => unselected.includes(item))) context.addIssue({ code: "custom", message: "An attribute answer cannot be both selected and unselected." })
  }).optional(),
}).strict().superRefine((value, context) => {
  if ([value.values, value.uriValues, value.repeatedEnumValue].filter((item) => item !== undefined).length !== 1) {
    context.addIssue({ code: "custom", message: "Supply exactly one attribute value representation. To clear, omit the attribute from the values and retain its mask." })
  }
})

const attribute = z.object({
  name: z.string(),
  values: z.array(z.unknown()).optional(),
  uriValues: z.array(z.object({ uri: z.string() })).optional(),
  repeatedEnumValue: z.object({
    setValues: z.array(z.string()).optional(),
    unsetValues: z.array(z.string()).optional(),
  }).optional(),
})

const metadataRow = z.object({ parent: z.string(), valueType: z.string(), deprecated: z.boolean().optional(), repeatable: z.boolean().optional(), valueMetadata: z.array(z.object({ value: z.unknown() })).optional() })

export function unsupportedAttributeNames(metadata: unknown, expected: unknown, mask: readonly string[]): string[] {
  const rows = z.array(metadataRow).safeParse(metadata)
  const values = z.array(googleAttributeWriteSchema).safeParse(expected)
  if (!rows.success || !values.success) return [...mask]
  return mask.filter((name) => {
    const matches = rows.data.filter((row) => row.parent === name)
    const meta = matches[0]
    if (matches.length !== 1 || !meta || meta.deprecated) return true
    const requested = values.data.find((value) => value.name === name)
    if (!requested) return false
    switch (meta.valueType) {
      case "BOOL": return !requested.values || requested.values.some((value) => typeof value !== "boolean")
      case "ENUM": return !requested.values || requested.values.some((value) => !meta.valueMetadata?.some((option) => option.value === value))
      case "URL": return !requested.uriValues || (meta.repeatable !== true && requested.uriValues.length > 1)
      case "REPEATED_ENUM": {
        const answers = requested.repeatedEnumValue
        return !answers || [...(answers.setValues ?? []), ...(answers.unsetValues ?? [])].some((value) => !meta.valueMetadata?.some((option) => option.value === value))
      }
      default: return true
    }
  })
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

function answers(value: z.infer<typeof attribute>): string {
  return canonical({
    values: value.values ?? [],
    uriValues: (value.uriValues ?? []).map(({ uri }) => uri).sort(),
    setValues: [...(value.repeatedEnumValue?.setValues ?? [])].sort(),
    unsetValues: [...(value.repeatedEnumValue?.unsetValues ?? [])].sort(),
  })
}

/** A masked name omitted from the request is a deletion, including an explicit false answer. */
export function googleAttributesMatch(observed: unknown, expected: unknown, mask: readonly string[]): boolean {
  const actual = z.object({ attributes: z.array(attribute).default([]) }).safeParse(observed)
  const requested = z.array(attribute).safeParse(expected)
  if (!actual.success || !requested.success || mask.length === 0 || new Set(mask).size !== mask.length) return false
  return mask.every((name) => {
    const before = requested.data.filter((item) => item.name === name)
    const after = actual.data.attributes.filter((item) => item.name === name)
    if (before.length > 1 || after.length > 1) return false
    if (!before[0]) return after.length === 0
    return after[0] !== undefined && answers(before[0]) === answers(after[0])
  })
}
