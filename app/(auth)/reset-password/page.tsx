import { AuthCard } from "@/components/auth/auth-card"
import { AuthLink } from "@/components/auth/auth-link"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export const metadata = { title: "Choose a new password · NabaPresence" }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>
}) {
  const params = await searchParams
  return (
    <AuthCard
      aside="reset"
      eyebrow="Account recovery"
      title="Choose a new password"
      description="Pick a new password. You will stay signed out everywhere else until you use it."
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      <ResetPasswordForm tokenHash={params.token_hash} />
    </AuthCard>
  )
}
