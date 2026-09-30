import { listBulkOperations } from "@/lib/server/bulk-listings"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({ handler: async ({ session }) => listBulkOperations(session) })
