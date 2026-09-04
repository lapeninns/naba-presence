import { AuthCard } from "@/components/auth/auth-card"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata = { title: "Reset your password · NabaPresence" }

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      eyebrow="Account"
      title="Reset your password"
      description="If that email belongs to an account, a reset link is on its way. Your clients' Google connections are not affected."
      footer={
        <a className="underline underline-offset-4" href="/sign-in">
          Back to sign in
        </a>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  )
}
