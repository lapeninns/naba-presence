import { AuthCard } from "@/components/auth/auth-card"
import { AuthLink } from "@/components/auth/auth-link"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata = { title: "Reset your password · NabaPresence" }

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      aside="recovery"
      eyebrow="Account recovery"
      title="Reset your password"
      description="We’ll email you a link to choose a new password. Your Google connections are not affected."
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <ForgotPasswordForm />
    </AuthCard>
  )
}
