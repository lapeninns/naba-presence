import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SignInView } from "@/components/naba-presence/sign-in-view"
import { getSession } from "@/lib/server/session"

export const metadata: Metadata = {
  title: "Sign in — NabaPresence",
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; status?: string }>
}) {
  if (await getSession()) redirect("/reviews")
  const params = await searchParams
  return (
    <SignInView
      errorStatus={
        params.email === "error"
          ? (params.status ?? "unknown")
          : undefined
      }
    />
  )
}
