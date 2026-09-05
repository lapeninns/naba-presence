/**
 * The pre-auth screens: one centred card on the grouped canvas. The card
 * itself (AuthCard) is the page's `<main>` and carries the brand mark, so
 * this layout only centres it and stays free of landmarks.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:py-16">
        {children}
      </div>
    </div>
  )
}
