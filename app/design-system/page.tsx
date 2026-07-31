import { Plus } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

type SectionTitle =
  | "Foundations"
  | "Typography"
  | "Spacing and radius"
  | "Primitives"

const SECTION_IDS: Record<SectionTitle, string> = {
  Foundations: "foundations",
  Typography: "typography",
  "Spacing and radius": "spacing-and-radius",
  Primitives: "primitives",
}

const THEME_EVIDENCE = [
  {
    name: "Light",
    className: "border-[#DADCE0] bg-white text-[#202124]",
    mutedClassName: "text-[#5F6368]",
    pairs: [
      ["foreground / background", "#202124 / #FFFFFF", "16.10:1"],
      ["muted foreground / background", "#5F6368 / #FFFFFF", "6.05:1"],
      ["white / primary", "#FFFFFF / #1A73E8", "4.51:1"],
      ["accent foreground / accent", "#0B57D0 / #E8F0FE", "5.57:1"],
      ["destructive / background", "#B3261E / #FFFFFF", "6.54:1"],
      ["success / background", "#146C2E / #FFFFFF", "6.53:1"],
      ["info foreground / info", "#FFFFFF / #0083B0", "4.34:1"],
    ],
    hierarchy:
      "Card #FFFFFF (solid); context/metric 66% card mix; shell glass 70% card mix; forms, tables and overlays stay solid.",
  },
  {
    name: "Dark",
    className: "border-white/12 bg-[#1F1F1F] text-[#E8EAED]",
    mutedClassName: "text-[#9AA0A6]",
    pairs: [
      ["foreground / background", "#E8EAED / #1F1F1F", "13.68:1"],
      ["muted foreground / background", "#9AA0A6 / #1F1F1F", "6.24:1"],
      ["primary foreground / primary", "#062E6F / #A8C7FA", "7.50:1"],
      ["accent foreground / accent", "#E8EAED / #1F3760", "9.82:1"],
      ["destructive / background", "#F2B8B5 / #1F1F1F", "9.65:1"],
      ["success / background", "#6DD58C / #1F1F1F", "9.06:1"],
      ["info foreground / info", "#202124 / #6EC3EB", "8.22:1"],
    ],
    hierarchy:
      "Card #28292C (solid); context/metric 66% card mix; shell glass 70% card mix; 12% borders and 15% input fill are translucent token layers.",
  },
] as const

function Section({
  title,
  children,
}: {
  title: SectionTitle
  children: React.ReactNode
}) {
  const id = `section-${SECTION_IDS[title]}`

  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="font-heading text-base font-semibold">
        {title}
      </h2>
      {children}
      <hr className="border-t" />
    </section>
  )
}

export const metadata = { title: "Design system · NabaPresence" }

export default function Page() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-(--nr-page-max-width) flex-col gap-(--nr-gap-section) px-5 py-6 md:px-(--nr-page-pad-x) md:py-(--nr-page-pad-y)">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          NabaPresence design system
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The frontend is being rebuilt on this branch. Foundation primitives
          (Button, Card, Badge, Alert, Skeleton, Spinner) are re-admitted
          below; remaining primitives and shared compositions return in later
          milestone tasks.
        </p>
      </header>

      <Section title="Foundations">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Authoritative token values and measured WCAG pairs. These specimens
          use literal documented colours, so the ambient page theme cannot
          relabel or recolour the evidence.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {THEME_EVIDENCE.map((theme) => (
            <article
              key={theme.name}
              data-theme-probe={theme.name.toLowerCase()}
              aria-label={`${theme.name} theme contrast evidence`}
              className={`rounded-(--nr-radius-panel) border p-5 ${theme.className}`}
            >
              <h3 className="font-heading text-base font-semibold">
                {theme.name} theme
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {theme.pairs.map(([pair, values, ratio]) => (
                  <div key={pair} className="min-w-0">
                    <p className="text-xs font-semibold">{pair}</p>
                    <p className={`font-mono text-xs ${theme.mutedClassName}`}>
                      {values}
                    </p>
                    <p className={`font-mono text-xs ${theme.mutedClassName}`}>
                      {ratio}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-3">
                <div className="flex flex-col gap-2">
                  <div className="bg-info text-info-foreground rounded-(--nr-radius-control) px-4 py-3 text-sm font-semibold">
                    Info swatch
                  </div>
                  <p className="text-xs text-muted-foreground">bg-info text-info-foreground</p>
                </div>
              </div>
              <p className={`mt-4 text-xs leading-5 ${theme.mutedClassName}`}>
                <span className="font-semibold">Surface hierarchy:</span>{" "}
                {theme.hierarchy}
              </p>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1">
            <p className="text-caption font-semibold">Caption</p>
            <p className="text-xs text-muted-foreground">11px (0.6875rem)</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-ui font-semibold">UI</p>
            <p className="text-xs text-muted-foreground">13px (0.8125rem)</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-body font-semibold">Body</p>
            <p className="text-xs text-muted-foreground">13.5px (0.84375rem)</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-title font-semibold">Title</p>
            <p className="text-xs text-muted-foreground">15px (0.9375rem)</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-page-title font-semibold">Page Title</p>
            <p className="text-xs text-muted-foreground">22px (1.375rem)</p>
          </div>
        </div>
      </Section>

      <Section title="Spacing and radius">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Controls", "12px"],
            ["Fields", "14px"],
            ["Cards", "18px"],
            ["Panels", "20px"],
          ].map(([name, value], index) => (
            <div
              key={name}
              className="border bg-card p-4 shadow-(--nr-shadow-card)"
              style={{
                borderRadius: `var(--nr-radius-${["control", "field", "card", "panel"][index]})`,
              }}
            >
              <p className="font-semibold">{name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {value}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          2px base scale · 14px card gap · 22px section gap · 18px card
          padding
        </p>
      </Section>

      <Section title="Primitives">
        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Button</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="default">Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon-xs" aria-label="Add item, extra small">
              <Plus />
            </Button>
            <Button size="icon-sm" aria-label="Add item, small">
              <Plus />
            </Button>
            <Button size="icon" aria-label="Add item">
              <Plus />
            </Button>
            <Button size="icon-lg" aria-label="Add item, large">
              <Plus />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Badge</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="ghost">Ghost</Badge>
            <Badge variant="link">Link</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="info">Info</Badge>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Alert</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Alert variant="default">
              <AlertTitle>Default</AlertTitle>
              <AlertDescription>
                Neutral informational message.
              </AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>Destructive</AlertTitle>
              <AlertDescription>
                Something needs attention now.
              </AlertDescription>
            </Alert>
            <Alert variant="success">
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>Changes published.</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <AlertTitle>Data may be out of date</AlertTitle>
              <AlertDescription>Retry to refresh.</AlertDescription>
            </Alert>
            <Alert variant="info">
              <AlertTitle>Info</AlertTitle>
              <AlertDescription>Syncing in the background.</AlertDescription>
            </Alert>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Card</h3>
          <Card className="max-w-sm">
            <CardHeader>
              <CardTitle as="h2">Reply performance</CardTitle>
              <CardDescription>
                Last 30 days across all locations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-body">
                92% of reviews replied to within 24 hours.
              </p>
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="outline">
                View report
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Skeleton</h3>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Spinner</h3>
          <Spinner />
        </div>
      </Section>
    </main>
  )
}
