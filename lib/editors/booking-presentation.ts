/**
 * Booking-link presentation: the words and order for Google's place-action
 * types, and the client-side link check. The link rule mirrors the wire
 * contract (`placeActionInputSchema`: a URL on http or https), so the form
 * never refuses a link the server would accept, it only says why earlier.
 * The one extra check, a link already on the same button, stops a duplicate
 * Google would only list twice.
 */

export const ACTION_TYPE_COPY: Record<
  string,
  { label: string; description: string }
> = {
  DINING_RESERVATION: {
    label: "Reserve a table",
    description: "Customers book a table on your booking site.",
  },
  FOOD_ORDERING: {
    label: "Order online",
    description: "Customers order food for collection or delivery.",
  },
  FOOD_DELIVERY: {
    label: "Delivery",
    description: "Customers order food to be delivered.",
  },
  FOOD_TAKEOUT: {
    label: "Takeaway",
    description: "Customers order food to collect.",
  },
  APPOINTMENT: {
    label: "Book",
    description:
      "For bookable things other than tables, such as a function room.",
  },
  ONLINE_APPOINTMENT: {
    label: "Book online",
    description: "Customers book an online appointment.",
  },
  SHOP_ONLINE: {
    label: "Shop online",
    description: "Customers buy from your online shop.",
  },
}

export function humaniseActionType(type: string): string {
  const lower = type.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function actionTypeLabel(type: string): string {
  return ACTION_TYPE_COPY[type]?.label ?? humaniseActionType(type)
}

/** A sentence saying what is wrong with the link, or null when it is fine. */
export function checkBookingUrl(
  value: string,
  existing: readonly { uri: string }[] = []
): string | null {
  const trimmed = value.trim()
  if (!trimmed) return "Enter the link customers should open."
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return "That isn’t a full web address. It should look like https://book.example.co.uk"
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return "Use a web address that starts with https://"
  if (existing.some((link) => link.uri === trimmed))
    return "This link is already on the listing for that button."
  return null
}

export function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname
  } catch {
    return uri
  }
}
