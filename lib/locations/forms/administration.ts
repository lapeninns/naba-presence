import { z } from "zod"

export const createAdminSchema = z.object({
  scope: z.enum(["account", "location"]),
  admin: z.string().trim().email("Enter a valid email address."),
  role: z.enum(["OWNER", "MANAGER"]),
})
export type CreateAdminValues = z.infer<typeof createAdminSchema>

export const updateAdminSchema = z.object({ name: z.string().min(1), role: z.enum(["OWNER", "MANAGER"]) })
export const transferLocationSchema = z.object({ destinationAccount: z.string().trim().min(1, "Enter the destination Google account.") })
