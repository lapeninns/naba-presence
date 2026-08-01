import { AuthCard } from "@/components/auth/auth-card"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata = { title: "Reset your password · NabaPresence" }

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="We will send a reset link if the email belongs to an account."
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
