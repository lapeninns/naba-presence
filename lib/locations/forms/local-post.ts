import { z } from "zod"

const callToActionSchema = z
  .object({ actionType: z.enum(["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"]), url: z.url().optional() })
  .optional()

// Verbatim mirror of localPostInputSchema in lib/server/posts.ts — keep in sync.
export const localPostFormSchema = z
  .object({
    topicType: z.enum(["STANDARD", "EVENT", "OFFER"]),
    languageCode: z.string().trim().min(2).max(16).default("en-GB"),
    summary: z.string().trim().max(1500).default(""),
    callToAction: callToActionSchema,
    event: z.record(z.string(), z.unknown()).optional(),
    offer: z
      .object({
        couponCode: z.string().trim().max(100).optional(),
        redeemOnlineUrl: z.url().optional(),
        termsConditions: z.string().trim().max(5000).optional(),
      })
      .optional(),
    media: z.array(z.object({ sourceUrl: z.url() })).max(10).default([]),
    scheduledTime: z.iso.datetime().optional(),
  })
  .superRefine((value, context) => {
    if ((value.topicType === "EVENT" || value.topicType === "OFFER") && !value.event) {
      context.addIssue({ code: "custom", path: ["event"], message: "Event details are required for event and offer posts." })
    }
    if (value.topicType === "OFFER" && !value.offer) {
      context.addIssue({ code: "custom", path: ["offer"], message: "Offer details are required for offer posts." })
    }
  })

export type LocalPostFormValues = z.infer<typeof localPostFormSchema>
