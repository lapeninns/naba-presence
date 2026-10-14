// Wire vocabulary for the listing editors' freshness (W3-2, AR-4). Client-safe.
import { z } from "zod"

/**
 * Where an editor GET took Google's side from: "live" read it for this
 * response; "stored" served the latest observation because it is within the
 * editor's staleness budget.
 */
export const editorReadSourceSchema = z.enum(["stored", "live"])
export type EditorReadSource = z.infer<typeof editorReadSourceSchema>

/** `?refresh=1` on an editor GET: read Google now, past the budget. */
export const editorRefreshQuerySchema = z.object({
  refresh: z.literal("1").optional(),
})
