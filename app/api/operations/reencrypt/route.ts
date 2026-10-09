import { z } from "zod"

import { rotateEncryptionKeys } from "@/lib/server/key-rotation"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const bodySchema = z.object({
  /** Count what is left without rewriting anything. */
  dryRun: z.boolean().default(false),
  batchSize: z.number().int().min(1).max(500).default(100),
  /** Rotate these organisations only, e.g. one tenant first. */
  organisationIds: z.array(z.uuid()).max(500).optional(),
})

/**
 * Operator endpoint for an encryption key rotation (docs/runbook.md,
 * "Rotating the token encryption key"). Cron-bearer authenticated and never
 * scheduled: run it by hand after deploying a new TOKEN_ENCRYPTION_KEYS, and
 * repeat until it reports `complete: true`. Resumable: every call continues
 * from what is still on an old key.
 */
export const POST = route({
  auth: "cron",
  body: bodySchema,
  handler: ({ body }) =>
    rotateEncryptionKeys({
      dryRun: body.dryRun,
      batchSize: body.batchSize,
      budgetMs: 45_000,
      organisationIds: body.organisationIds,
    }),
})
