import { describe, expect, it } from "vitest"
import { ZodError, z } from "zod"

import { ApiError, apiError } from "@/lib/server/http"
import {
  administrationMutationSchema,
  createAdminSchema,
} from "@/lib/locations/forms/administration"
import { industryMutationSchema } from "@/lib/locations/forms/industry"
import { businessInformationFormSchema } from "@/lib/locations/forms/business-information"

describe("api error envelope", () => {
  it("includes fieldErrors and flags from ApiError", async () => {
    const response = apiError(
      new ApiError(422, "invalid_request", "Check the highlighted fields.", {
        fieldErrors: { title: "Required" },
        retryable: true,
        reconnectRequired: true,
        requestId: "req-1",
      })
    )
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
      message: "Check the highlighted fields.",
      requestId: "req-1",
      fieldErrors: { title: "Required" },
      retryable: true,
      reconnectRequired: true,
    })
  })

  it("maps Zod issues into fieldErrors", async () => {
    try {
      z.object({ email: z.string().email() }).parse({ email: "nope" })
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      const response = apiError(error)
      const body = await response.json()
      expect(body.error).toBe("invalid_request")
      expect(body.fieldErrors.email).toMatch(/email/i)
    }
  })
})

describe("slice 0 form contracts", () => {
  it("accepts a create-admin form", () => {
    expect(
      createAdminSchema.parse({
        scope: "location",
        admin: "owner@example.com",
        role: "MANAGER",
      })
    ).toMatchObject({ role: "MANAGER" })
  })

  it("requires the matching administration confirmation", () => {
    const result = administrationMutationSchema.safeParse({
      operation: "delete_location",
      confirmation: "wrong",
      payload: {},
    })
    expect(result.success).toBe(false)
  })

  it("accepts a typed business-calls industry mutation", () => {
    expect(
      industryMutationSchema.parse({
        operation: "update_business_calls",
        confirmation: "publish_industry_data_to_google",
        updateMask: ["callsState"],
        payload: { callsState: "ENABLED" },
      }).operation
    ).toBe("update_business_calls")
  })

  it("accepts a business information form draft", () => {
    expect(
      businessInformationFormSchema.parse({
        title: "Riverside Inn",
        primaryPhone: "+44 1225 000000",
      }).title
    ).toBe("Riverside Inn")
  })
})
