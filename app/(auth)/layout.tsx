import { Check } from "lucide-react"

import { BrandMark } from "@/components/app-shell/brand-mark"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <aside
        aria-label="About NabaPresence"
        className="hidden min-h-svh flex-col justify-between border-r border-sidebar-border/70 bg-sidebar px-10 py-12 text-sidebar-foreground lg:flex xl:px-16 xl:py-16"
      >
        <BrandMark size="lg" />

        <div className="flex max-w-md flex-col gap-8">
          <p className="text-page-title font-semibold tracking-tight text-balance">
            Nab a Presence
          </p>

          <ul className="flex flex-col gap-4">
            {[
              "Every Google review in one inbox",
              "Verify a reply before it goes live",
              "Publish straight to Google Business Profile",
            ].map((beat) => (
              <li
                key={beat}
                className="flex items-center gap-3 text-body font-medium"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-(--nr-radius-control) bg-accent text-accent-foreground">
                  <Check className="size-4" aria-hidden />
                </span>
                {beat}
              </li>
            ))}
          </ul>
        </div>

        <p className="max-w-md text-caption leading-relaxed text-sidebar-foreground/70">
          Your team signs in here. Google Business Profile is connected once for
          the organisation by an owner in Settings.
        </p>
      </aside>

      <div className="flex min-h-svh flex-col">
        <header className="px-5 pt-6 lg:hidden">
          <BrandMark size="sm" />
        </header>
        <div className="flex flex-1 items-center justify-center px-5 py-10">
          {children}
        </div>
      </div>
    </div>
  )
}
