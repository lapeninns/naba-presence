import { redirect } from "next/navigation"

import {
  getSession,
  isLocalBootstrapEnabled,
} from "@/lib/server/session"

export default async function Page() {
  const session = await getSession()
  const allowAnonymous =
    process.env.NODE_ENV !== "production" ||
    isLocalBootstrapEnabled()
  redirect(session || allowAnonymous ? "/home" : "/sign-in")
}
