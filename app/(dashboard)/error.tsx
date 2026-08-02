"use client"

import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex min-h-[60svh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-6 text-center">
      <Alert variant="destructive">
        <AlertTitle>This page hit an error</AlertTitle>
        <AlertDescription>
          The rest of NabaPresence is still working. Try again, or go back to
          Home.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        {/* A real <a> styled as a button, not Button+render — see the note in
            app/not-found.tsx for why. cn() dedupes buttonVariants' own
            conflicting base/variant utility classes (e.g. border-color). */}
        <Link
          href="/home"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Go to Home
        </Link>
      </div>
    </main>
  )
}
