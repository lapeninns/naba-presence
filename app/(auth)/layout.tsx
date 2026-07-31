export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-5 py-10">
      {children}
    </div>
  )
}
