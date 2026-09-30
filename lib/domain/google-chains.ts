import { z } from "zod"

const chainSearchSchema = z.object({
  chains: z.array(z.object({
    name: z.string().regex(/^chains\/[^/\s]+$/),
    chainNames: z.array(z.object({ displayName: z.string().min(1), languageCode: z.string().optional() })).optional(),
  })).optional(),
})

export function chainSearchChoices(value: unknown): { name: string; label: string }[] | null {
  const parsed = chainSearchSchema.safeParse(value)
  if (!parsed.success) return null
  const chains = parsed.data.chains ?? []
  if (new Set(chains.map((chain) => chain.name)).size !== chains.length) return null
  return chains.map((chain) => ({ name: chain.name, label: chain.chainNames?.find((name) => /^en(?:-|$)/i.test(name.languageCode ?? ""))?.displayName ?? chain.chainNames?.[0]?.displayName ?? chain.name }))
}
