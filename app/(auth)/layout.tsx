/**
 * The pre-auth screens: two columns from `lg` (64rem), the charcoal product
 * panel taking what the card column (a fixed `w-130`, 32.5rem) leaves;
 * below that the card column stands alone. `AuthCard` draws both columns (its panel copy differs per screen)
 * and owns the `<main>`, so this layout stays free of landmarks.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-surface text-ink lg:flex-row">
      {children}
    </div>
  )
}
