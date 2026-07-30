import { CapabilityPlaceholder } from "@/components/naba-presence/capability-placeholder"
import { getServerEnv } from "@/lib/server/env"

export const metadata = { title: "Menu · NabaPresence" }

export default function LocationMenuPage() {
  return (
    <CapabilityPlaceholder
      capability="Menu"
      flag="GBP_FOOD_MENUS_ENABLED"
      enabled={getServerEnv().GBP_FOOD_MENUS_ENABLED}
      description="Canonical food and drink menus projected into Google FoodMenus."
    />
  )
}
