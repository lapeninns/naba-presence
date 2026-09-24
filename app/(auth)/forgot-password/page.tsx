import { AuthCard } from "@/components/auth/auth-card"
import { AuthLink } from "@/components/auth/auth-link"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { emailSchema } from "@/lib/domain/auth"

export const metadata = { title: "Reset your password · NabaPresence" }

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams
  // Only a well-formed address pre-fills the field; anything else is ignored
  // rather than echoed back into the page.
  const initialEmail = emailSchema.safeParse(email).success ? email : undefined
  return (
    <AuthCard
      aside="recovery"
      eyebrow="Account recovery"
      title="Reset your password"
      description="Enter the email you sign in with. We’ll send a link to choose a new password. Your clients’ Google connections are not affected."
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <ForgotPasswordForm initialEmail={initialEmail} />
    </AuthCard>
  )
}
