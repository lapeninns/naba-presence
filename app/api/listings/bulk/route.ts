import { listBulkOperations } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

export const GET = route({ maxDuration, handler: async ({ session }) => listBulkOperations(session) })
