import { z } from "zod"
import {
  googleServiceItemSchema,
  googleServiceItemsSchema,
  googleServicePriceSchema,
  type GoogleServiceItem,
} from "@/lib/domain/google-services"

const structuredDraft = googleServiceItemSchema.options[0]
const freeFormDraft = googleServiceItemSchema.options[1]
const draftItemSchema = z.union([
  structuredDraft.extend({
    structuredServiceItem: structuredDraft.shape.structuredServiceItem.extend({
      description: z.string().optional(),
    }),
  }),
  freeFormDraft.extend({
    freeFormServiceItem: freeFormDraft.shape.freeFormServiceItem.extend({
      label: freeFormDraft.shape.freeFormServiceItem.shape.label.extend({
        displayName: z.string(),
      }),
    }),
  }),
])

export const serviceDraftRowSchema = z.object({
  item: draftItemSchema,
  priceEdit: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("keep") }),
    z.object({ mode: z.literal("clear") }),
    z.object({
      mode: z.literal("set"),
      amount: z.string(),
      currency: z.string(),
    }),
  ]),
})
export type ServiceDraftRow = z.infer<typeof serviceDraftRowSchema>

export function parseServiceDraft(value: unknown): ServiceDraftRow[] | null {
  const parsed = z.array(serviceDraftRowSchema).max(100).safeParse(value)
  return parsed.success ? parsed.data : null
}

export function setServiceDescription(
  item: GoogleServiceItem,
  description: string | undefined
): GoogleServiceItem {
  if ("freeFormServiceItem" in item) {
    const label = { ...item.freeFormServiceItem.label }
    if (description === undefined) delete label.description
    else label.description = description
    return {
      ...item,
      freeFormServiceItem: { ...item.freeFormServiceItem, label },
    }
  }
  const structuredServiceItem = { ...item.structuredServiceItem }
  if (description === undefined) delete structuredServiceItem.description
  else structuredServiceItem.description = description
  return { ...item, structuredServiceItem }
}

export function serviceDraftRows(
  items: readonly GoogleServiceItem[]
): ServiceDraftRow[] {
  return items.map((item) => ({ item, priceEdit: { mode: "keep" } }))
}

export function servicePriceText(price: GoogleServiceItem["price"]): string {
  if (!price || (price.units === undefined && price.nanos === undefined))
    return ""
  const units = price.units ?? "0"
  const nanos = price.nanos ?? 0
  const negative = units.startsWith("-") || nanos < 0
  const fraction = String(Math.abs(nanos)).padStart(9, "0").replace(/0+$/, "")
  return `${negative ? "-" : ""}${units.replace(/^-/, "")}${fraction ? `.${fraction}` : ""}`
}

export function parseServicePrice(amount: string, currency: string) {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,9}))?$/.exec(amount.trim())
  if (!match)
    return {
      success: false as const,
      message: "Enter a price with up to nine decimal places.",
    }
  const units = match[2] === "0" ? "0" : `${match[1]}${match[2]}`
  const nanos = Number((match[3] ?? "").padEnd(9, "0")) * (match[1] ? -1 : 1)
  const parsed = googleServicePriceSchema.safeParse({
    currencyCode: currency.trim().toUpperCase(),
    units,
    nanos,
  })
  return parsed.success
    ? { success: true as const, price: parsed.data }
    : {
        success: false as const,
        message: "Enter a three-letter currency and a valid price.",
      }
}

export function buildServiceItems(rows: readonly ServiceDraftRow[]) {
  const items: GoogleServiceItem[] = []
  for (const [index, row] of rows.entries()) {
    const { price: originalPrice, ...withoutPrice } = row.item
    switch (row.priceEdit.mode) {
      case "keep":
        items.push(
          originalPrice === undefined
            ? withoutPrice
            : { ...withoutPrice, price: originalPrice }
        )
        break
      case "clear":
        items.push(withoutPrice)
        break
      case "set": {
        const result = parseServicePrice(
          row.priceEdit.amount,
          row.priceEdit.currency
        )
        if (!result.success)
          return {
            success: false as const,
            message: `Service ${index + 1}: ${result.message}`,
          }
        items.push({ ...withoutPrice, price: result.price })
        break
      }
    }
  }
  const parsed = googleServiceItemsSchema.safeParse(items)
  return parsed.success
    ? { success: true as const, items: parsed.data }
    : {
        success: false as const,
        message:
          parsed.error.issues[0]?.message ?? "Check the service details.",
      }
}
