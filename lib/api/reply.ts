import { apiFetch } from "./client"

export type { DeleteReplyResult } from "@/lib/contracts/reviews"

export function deletePublishedReply(reviewId: string) {
  return apiFetch(`/api/reviews/${reviewId}/reply`, {
    method: "DELETE",
    schema: () =>
      import("@/lib/contracts/reviews").then((m) => m.deleteReplyResultSchema),
  })
}
