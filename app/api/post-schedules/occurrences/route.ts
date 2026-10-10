import { occurrencesQuerySchema } from "@/lib/contracts/publication-schedules"
import { listScheduleOccurrences } from "@/lib/server/publication-schedules"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** Calendar and agenda occurrences for locations the viewer can see. */
export const GET = route({ query: occurrencesQuerySchema, handler: async ({ session, query }) => listScheduleOccurrences(session, query) })
