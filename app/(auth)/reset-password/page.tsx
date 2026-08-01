import { AuthCard } from "@/components/auth/auth-card"
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
      title="Choose a new password"
      description="Enter a new password to finish resetting your account."
      footer={
        <a className="underline underline-offset-4" href="/sign-in">
          Back to sign in
        </a>
      }
    >
      <ResetPasswordForm tokenHash={params.token_hash} />
    </AuthCard>
  )
}
