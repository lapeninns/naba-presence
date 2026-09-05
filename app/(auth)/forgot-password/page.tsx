import { AuthCard } from "@/components/auth/auth-card"
import { AuthLink } from "@/components/auth/auth-link"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata = { title: "Reset your password · NabaPresence" }

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      eyebrow="Account"
      title="Reset your password"
      description="If that email belongs to an account, a reset link is on its way. Your clients' Google connections are not affected."
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <ForgotPasswordForm />
    </AuthCard>
  )
}
