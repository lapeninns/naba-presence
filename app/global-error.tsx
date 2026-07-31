"use client"

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="flex min-h-svh items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm">
            NabaPresence hit an unexpected error. Your data is unaffected.
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
