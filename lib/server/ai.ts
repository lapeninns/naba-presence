import "server-only"

import { z } from "zod"

import {
  buildMenuChatPrompt,
  type MenuChatTurn,
  type MenuContent,
  type PublicMenu,
} from "@/lib/domain/menu"
import { buildReplyPrompt, type DraftTone } from "@/lib/domain/reply-policy"
import type { VerificationReason } from "@/lib/domain/verification"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"

type JsonSchema = Record<string, unknown>

function responseText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") return response.output_text
  const output = Array.isArray(response.output) ? response.output : []
  for (const item of output) {
    if (!item || typeof item !== "object") continue
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content: unknown[] }).content ?? [])
      : []
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "output_text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return (block as { text: string }).text
      }
    }
  }
  throw new ApiError(
    502,
    "ai_empty_response",
    "The AI provider returned no text."
  )
}

async function openAiStructured<T>(
  model: string,
  name: string,
  schema: JsonSchema,
  input: unknown,
  validator: z.ZodType<T>,
  options: {
    reasoningEffort?: "none" | "low" | "medium" | "high"
    unavailableMessage?: string
  } = {}
): Promise<T> {
  const env = getServerEnv()
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(
      503,
      "ai_not_configured",
      options.unavailableMessage ?? "AI features are not configured."
    )
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
      ...(env.OPENAI_ORG_ID
        ? { "OpenAI-Organization": env.OPENAI_ORG_ID }
        : {}),
    },
    body: JSON.stringify({
      model,
      input,
      store: false,
      ...(options.reasoningEffort
        ? { reasoning: { effort: options.reasoningEffort } }
        : {}),
      text: {
        format: {
          type: "json_schema",
          name,
          strict: true,
          schema,
        },
      },
    }),
    cache: "no-store",
  })
  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    const error =
      payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>)
        : {}
    throw new ApiError(
      response.status,
      String(error.code ?? "ai_provider_error"),
      String(error.message ?? "The AI provider rejected the request.")
    )
  }
  return validator.parse(JSON.parse(responseText(payload)))
}

const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(800).nullable(),
  price: z.string().trim().max(80).nullable(),
  dietaryTags: z.array(z.string().trim().min(1).max(80)).max(20),
  allergens: z.array(z.string().trim().min(1).max(80)).max(20),
  allergenInformationExplicit: z.boolean(),
})

const menuContentSchema = z.object({
  menuName: z.string().trim().min(1).max(160),
  currencyCode: z.string().trim().min(3).max(3).nullable(),
  notes: z.array(z.string().trim().min(1).max(500)).max(40),
  categories: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(800).nullable(),
        items: z.array(menuItemSchema).max(120),
      })
    )
    .min(1)
    .max(60),
})

const menuContentJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    menuName: { type: "string" },
    currencyCode: { type: ["string", "null"] },
    notes: {
      type: "array",
      items: { type: "string" },
      maxItems: 40,
    },
    categories: {
      type: "array",
      minItems: 1,
      maxItems: 60,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: ["string", "null"] },
          items: {
            type: "array",
            maxItems: 120,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: ["string", "null"] },
                price: { type: ["string", "null"] },
                dietaryTags: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 20,
                },
                allergens: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 20,
                },
                allergenInformationExplicit: { type: "boolean" },
              },
              required: [
                "name",
                "description",
                "price",
                "dietaryTags",
                "allergens",
                "allergenInformationExplicit",
              ],
            },
          },
        },
        required: ["name", "description", "items"],
      },
    },
  },
  required: ["menuName", "currencyCode", "notes", "categories"],
} satisfies JsonSchema

export async function extractMenu(input: {
  filename: string
  mediaType: string
  base64: string
}): Promise<MenuContent> {
  const isImage = input.mediaType.startsWith("image/")
  const documentInput = isImage
    ? {
        type: "input_image",
        image_url: `data:${input.mediaType};base64,${input.base64}`,
        detail: "high",
      }
    : {
        type: "input_file",
        filename: input.filename,
        file_data: `data:${input.mediaType};base64,${input.base64}`,
        detail: input.mediaType === "application/pdf" ? "high" : undefined,
      }

  return openAiStructured(
    getServerEnv().OPENAI_MODEL_MENU_EXTRACT,
    "menu_document",
    menuContentJsonSchema,
    [
      {
        role: "user",
        content: [
          documentInput,
          {
            type: "input_text",
            text: [
              "Extract this customer menu into the required schema.",
              "Preserve item names, descriptions, and displayed prices exactly.",
              "Keep the menu's category order and item order.",
              "Use an ISO 4217 currency code only when the document makes the currency clear; otherwise use null.",
              "Record dietary tags and allergens only when explicitly printed or unambiguously marked in the source.",
              "Set allergenInformationExplicit false when allergen data is absent or inferred.",
              "Put general service, dietary, and allergen statements in notes.",
              "Do not invent missing dishes, ingredients, prices, tags, or allergens.",
            ].join("\n"),
          },
        ],
      },
    ],
    menuContentSchema,
    {
      reasoningEffort: "none",
      unavailableMessage: "Menu extraction is not configured.",
    }
  )
}

const menuChatResultSchema = z.object({
  answer: z.string().trim().min(1).max(2000),
  referencedItems: z.array(z.string().trim().min(1).max(160)).max(12),
  allergenWarning: z.boolean(),
})

export async function answerMenuQuestion(input: {
  menu: PublicMenu
  message: string
  history: MenuChatTurn[]
}) {
  return openAiStructured(
    getServerEnv().OPENAI_MODEL_MENU_CHAT,
    "menu_chat_answer",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
        referencedItems: {
          type: "array",
          items: { type: "string" },
          maxItems: 12,
        },
        allergenWarning: { type: "boolean" },
      },
      required: ["answer", "referencedItems", "allergenWarning"],
    },
    buildMenuChatPrompt(input),
    menuChatResultSchema,
    {
      reasoningEffort: "none",
      unavailableMessage: "The menu assistant is not configured.",
    }
  )
}

const draftResultSchema = z.object({
  reply: z.string().trim().min(1).max(4096),
  language: z.string().trim().min(2).max(12),
})

export async function generateReply(input: {
  reviewText: string | null
  rating: number
  reviewerName: string | null
  locationName: string
  language: string
  tone: DraftTone
  businessContext?: string | null
}) {
  return openAiStructured(
    getServerEnv().OPENAI_MODEL_DRAFT,
    "google_review_reply",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        reply: { type: "string" },
        language: { type: "string" },
      },
      required: ["reply", "language"],
    },
    buildReplyPrompt(input),
    draftResultSchema
  )
}

const semanticVerificationSchema = z.object({
  unsupportedClaims: z.array(z.string().max(240)).max(10),
  unsafeEscalation: z.boolean(),
  toneMismatch: z.boolean(),
})

export async function semanticVerification(input: {
  body: string
  reviewText: string | null
  reviewerName?: string | null
  locationName: string
  rating: number
}): Promise<VerificationReason[]> {
  if (!getServerEnv().OPENAI_API_KEY) return []
  const result = await openAiStructured(
    getServerEnv().OPENAI_MODEL_VERIFY,
    "review_reply_verification",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        unsupportedClaims: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
        },
        unsafeEscalation: { type: "boolean" },
        toneMismatch: { type: "boolean" },
      },
      required: ["unsupportedClaims", "unsafeEscalation", "toneMismatch"],
    },
    [
      "Verify the proposed reply using only the supplied review evidence.",
      "List claims not supported by the review, reviewer name, or location name.",
      "Flag unsafe escalation (threats, legal conclusions, promises) and tone mismatch.",
      `Location: ${input.locationName}. Rating: ${input.rating}/5.`,
      `Reviewer display name: ${input.reviewerName ?? "anonymous"}.`,
      `Review: ${input.reviewText ?? "[rating-only review]"}`,
      `Proposed reply: ${input.body}`,
    ].join("\n"),
    semanticVerificationSchema
  )
  return [
    ...result.unsupportedClaims.map((claim) => ({
      code: "unsupported_claim",
      severity: "fail" as const,
      message: claim,
    })),
    ...(result.unsafeEscalation
      ? [
          {
            code: "unsafe_escalation",
            severity: "fail" as const,
            message: "The reply contains an unsafe escalation.",
          },
        ]
      : []),
    ...(result.toneMismatch
      ? [
          {
            code: "tone_mismatch",
            severity: "warn" as const,
            message: "The reply tone may not fit the review.",
          },
        ]
      : []),
  ]
}
