export type MenuItem = {
  name: string
  description: string | null
  price: string | null
  dietaryTags: string[]
  allergens: string[]
  allergenInformationExplicit: boolean
}

export type MenuCategory = {
  name: string
  description: string | null
  items: MenuItem[]
}

export type MenuContent = {
  menuName: string
  currencyCode: string | null
  notes: string[]
  categories: MenuCategory[]
}

export type PublicMenu = {
  slug: string
  name: string
  locationName: string
  currencyCode: string | null
  version: number
  updatedAt: string
  content: MenuContent
}

export type MenuChatTurn = {
  role: "user" | "assistant"
  content: string
}

export function buildMenuChatPrompt(input: {
  menu: PublicMenu
  message: string
  history: MenuChatTurn[]
}) {
  return [
    "Role: You are the customer-facing menu guide for this venue.",
    "Goal: Answer the guest's question using only the approved menu snapshot below.",
    "Success criteria:",
    "- Give a direct, conversational answer.",
    "- Preserve item names and displayed prices exactly.",
    "- Recommend only items that appear in the menu snapshot.",
    "- Put the exact menu item names used in referencedItems.",
    "Safety constraints:",
    "- Never claim that an item is allergy-safe or free from cross-contamination.",
    "- Treat dietary tags and allergens as unknown unless explicitly present in the menu data.",
    "- For allergy or intolerance questions, set allergenWarning true and tell the guest to confirm with staff before ordering.",
    "- If the menu does not contain the answer, say so instead of guessing.",
    "- Do not take orders, promise availability, or invent substitutions.",
    "Style: Warm, concise, and helpful. Use the language of the guest's latest message.",
    `Venue: ${input.menu.locationName}`,
    `Menu snapshot version: ${input.menu.version}`,
    `Approved menu JSON: ${JSON.stringify(input.menu.content)}`,
    `Recent conversation: ${JSON.stringify(input.history)}`,
    `Guest message: ${input.message}`,
  ].join("\n")
}
