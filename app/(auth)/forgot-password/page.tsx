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
      description="Enter the email you sign in with. We’ll send a link to choose a new password. Your clients’ Google connections are not affected."
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <ForgotPasswordForm />
    </AuthCard>
  )
}
