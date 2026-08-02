import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const metadata = { title: "Page not found · NabaPresence" }

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-6 text-center">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
      </div>
      {/* A plain, real <a> styled as a button — Base UI's Button primitive
          expects its `render` target to resolve to a native <button> unless
          told otherwise (`nativeButton={false}`, which the components/ui/button.tsx
          wrapper doesn't expose), so composing it with next/link would either
          warn or need touching a Task 7/8 primitive out of this task's scope.
          `cn()` (not a bare template literal) matters here: buttonVariants'
          base string and its variant string can target the same utility
          (e.g. border-color) and only twMerge's dedupe picks the right one. */}
      <Link href="/home" className={cn(buttonVariants())}>
        Go to Home
      </Link>
    </main>
  )
}
