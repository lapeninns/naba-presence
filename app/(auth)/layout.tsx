/**
 * The pre-auth screens: a two-column grid, the charcoal product panel and
 * the white card column, collapsing to the card column alone at 900px and
 * below. `AuthCard` draws both columns (its panel copy differs per screen)
 * and owns the `<main>`, so this layout stays free of landmarks.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-svh grid-cols-1 bg-surface text-ink min-[901px]:grid-cols-[minmax(0,1fr)_minmax(360px,520px)]">
      {children}
    </div>
  )
}
