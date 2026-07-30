import type { Metadata } from "next"

import { ForgotPasswordView } from "@/components/naba-presence/forgot-password-view"

export const metadata: Metadata = {
  title: "Reset password — NabaPresence",
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordView />
}
