import type { GoogleServiceItem } from "@/lib/domain/google-services"
import { servicePriceText } from "./forms/services"

export function onboardingServiceReviewRows(items: readonly GoogleServiceItem[]) {
  return items.flatMap((item, index) => {
    const prefix = `Service ${index + 1}`
    const rows = "structuredServiceItem" in item
      ? [
          { label: `${prefix} type`, value: "Suggested service" },
          { label: `${prefix} Google ID`, value: item.structuredServiceItem.serviceTypeId },
          { label: `${prefix} description`, value: item.structuredServiceItem.description ?? "Not supplied" },
        ]
      : [
          { label: `${prefix} type`, value: "Custom service" },
          { label: `${prefix} category`, value: item.freeFormServiceItem.category },
          { label: `${prefix} name`, value: item.freeFormServiceItem.label.displayName },
          { label: `${prefix} description`, value: item.freeFormServiceItem.label.description ?? "Not supplied" },
          { label: `${prefix} language`, value: item.freeFormServiceItem.label.languageCode ?? "Not supplied" },
        ]
    rows.push({ label: `${prefix} price`, value: item.price ? `${item.price.currencyCode ?? "Currency not supplied"} ${servicePriceText(item.price) || "Amount not supplied"}` : "Not supplied" })
    return rows
  })
}
