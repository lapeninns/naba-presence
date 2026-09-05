"use client"

import { TriangleAlert } from "lucide-react"

import "./globals.css"
import { PageEmptyState } from "@/components/app-shell/page-frame"
import { Button } from "@/components/ui/button"

/**
 * The root boundary: the root layout itself failed, so this file draws its
 * own `html` and `body`, and imports the stylesheet itself: the root layout
 * that normally loads it is exactly what is not rendering.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="flex min-h-svh items-center justify-center bg-canvas p-6 text-ink">
        <main id="main" tabIndex={-1} className="w-full outline-none">
          <PageEmptyState
            icon={<TriangleAlert strokeWidth={1.75} aria-hidden />}
            title="Something went wrong"
            description="NabaPresence hit an unexpected error. Your data is unaffected."
            action={<Button onClick={reset}>Try again</Button>}
          />
        </main>
      </body>
    </html>
  )
}
