/**
 * The pre-auth screens: a two-column grid, the charcoal product panel and
 * the white card column, from `lg` (64rem); below that the card column
 * stands alone. `AuthCard` draws both columns (its panel copy differs per screen)
 * and owns the `<main>`, so this layout stays free of landmarks.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-svh grid-cols-1 bg-surface text-ink lg:grid-cols-[minmax(0,1fr)_minmax(22.5rem,32.5rem)]">
      {children}
    </div>
  )
}
