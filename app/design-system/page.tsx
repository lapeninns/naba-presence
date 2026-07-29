"use client"

import { Activity, BarChart3, Inbox, Menu, Moon, Settings } from "lucide-react"
import { useTheme } from "next-themes"

import {
  BusinessContext,
  EmptyData,
  MetricCard,
  Stars,
  StatusBadge,
} from "@/components/naba-review/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type SectionTitle =
  | "Foundations"
  | "Typography"
  | "Spacing and radius"
  | "Elevation and glass"
  | "Controls"
  | "Status and feedback"
  | "Product compositions"

const SECTION_IDS: Record<SectionTitle, string> = {
  Foundations: "foundations",
  Typography: "typography",
  "Spacing and radius": "spacing-and-radius",
  "Elevation and glass": "elevation-and-glass",
  Controls: "controls",
  "Status and feedback": "status-and-feedback",
  "Product compositions": "product-compositions",
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
      <h2 id={id} className="font-heading text-[15px] font-semibold">
        {title}
      </h2>
      {children}
      <Separator />
    </section>
  )
}

export default function Page() {
  const { theme, setTheme } = useTheme()

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-(--nr-page-max-width) flex-col gap-(--nr-gap-section) px-5 py-6 md:px-(--nr-page-pad-x) md:py-(--nr-page-pad-y)">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">shadcn/ui</Badge>
            <Badge variant="secondary">Base UI</Badge>
          </div>
          <h1 className="font-heading text-[28px] font-bold tracking-tight">
            NabaReview design system
          </h1>
          <p className="max-w-2xl text-[13.5px] text-muted-foreground">
            Production foundations and shipping compositions for auditable
            public replies. The contrast evidence below is fixed to its named
            theme; use the visible control to inspect the ambient page in either
            theme.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Moon data-icon="inline-start" />
          Toggle theme
        </Button>
      </header>

      <Section title="Foundations">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Authoritative token values and measured WCAG pairs. These specimens
          use literal documented colors, so ambient theme changes cannot relabel
          or recolor the evidence.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {THEME_EVIDENCE.map((theme) => (
            <article
              key={theme.name}
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
                    <p
                      className={`font-mono text-[11px] ${theme.mutedClassName}`}
                    >
                      {values}
                    </p>
                    <p
                      className={`font-mono text-[11px] ${theme.mutedClassName}`}
                    >
                      {ratio}
                    </p>
                  </div>
                ))}
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
        <Card>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Geist heading</p>
              <p className="font-heading text-[22px] font-semibold">
                Clear review operations
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Geist body</p>
              <p className="text-[13.5px] leading-[1.45]">
                Human approval stays visible from review to published reply.
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Geist Mono numerals
              </p>
              <p className="font-mono text-2xl font-semibold">94.8% · 00:42</p>
            </div>
          </CardContent>
        </Card>
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
              <p className="font-mono text-xs text-muted-foreground">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          2px base scale · 14px card gap · 22px section gap · 18px card padding
        </p>
      </Section>

      <Section title="Elevation and glass">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Opaque reading surface</CardTitle>
            </CardHeader>
            <CardContent>
              Review prose, forms, tables and overlays remain opaque.
            </CardContent>
          </Card>
          <Card className="bg-[var(--nr-surface-card-translucent)] backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Light translucency</CardTitle>
            </CardHeader>
            <CardContent>
              Reserved for business context and metrics.
            </CardContent>
          </Card>
          <div className="rounded-(--nr-radius-shell) border border-[var(--nr-surface-glass-border)] bg-[var(--nr-surface-glass-strong)] p-(--nr-panel-pad) shadow-(--nr-shadow-float) backdrop-blur-xl">
            <p className="font-semibold">Strong glass</p>
            <p className="text-sm text-muted-foreground">
              Floating navigation chrome only. High-opacity fallback ships when
              blur is unavailable.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap gap-2">
          <Button>Publish reply</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="outline">Regenerate</Button>
          <Button variant="destructive">Delete</Button>
          <Button disabled>Pending</Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="outline" aria-label="Publishing guidance" />
              }
            >
              Publishing guidance
            </TooltipTrigger>
            <TooltipContent>
              Public replies require verification before publishing.
            </TooltipContent>
          </Tooltip>
        </div>
        <Card className="max-w-2xl bg-card">
          <CardHeader>
            <CardTitle>Opaque reply form</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="proof-name">Location</Label>
              <Input id="proof-name" defaultValue="Lapen Inn — Central" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                id="proof-approval"
                aria-label="Require approval"
                defaultChecked
              />
              <Label htmlFor="proof-approval">Require approval</Label>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="proof-reply">Reply draft</Label>
              <Textarea
                id="proof-reply"
                defaultValue="Thank you for sharing your experience."
              />
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Status and feedback">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="published" />
          <StatusBadge status="awaiting_approval" />
          <StatusBadge status="escalated" />
          <StatusBadge status="needs_reply" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Alert>
            <Activity />
            <AlertTitle>Sync complete</AlertTitle>
            <AlertDescription>
              24 reviews are ready for triage.
            </AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Connection needs attention</AlertTitle>
            <AlertDescription>
              Reconnect to resume review sync.
            </AlertDescription>
          </Alert>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Reply rate — 62%</Label>
            <Progress value={62} aria-label="Reply rate" className="mt-2" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
        <EmptyData message="Connect a location to begin receiving reviews." />
      </Section>

      <Section title="Product compositions">
        <div className="grid overflow-hidden rounded-(--nr-radius-shell) border bg-card shadow-(--nr-shadow-panel) md:grid-cols-[220px_1fr]">
          <nav
            aria-label="Proof primary navigation"
            className="border-b bg-[var(--nr-surface-glass-strong)] p-4 backdrop-blur-xl md:border-r md:border-b-0"
          >
            <p className="mb-3 font-heading font-semibold">NabaReview</p>
            <div className="grid gap-1">
              <Button variant="secondary" className="justify-start">
                <Inbox data-icon="inline-start" /> Reviews
              </Button>
              <Button variant="ghost" className="justify-start">
                <BarChart3 data-icon="inline-start" /> Analytics
              </Button>
              <Button variant="ghost" className="justify-start">
                <Settings data-icon="inline-start" /> Settings
              </Button>
            </div>
          </nav>
          <div className="min-w-0 space-y-4 p-4 md:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-heading text-lg font-semibold">
                  Review operations
                </p>
                <p className="text-xs text-muted-foreground">
                  Representative shipping shell and navigation
                </p>
              </div>
              <Button variant="outline" size="icon-sm" aria-label="Open menu">
                <Menu />
              </Button>
            </div>
            <BusinessContext
              organisationName="Naba Review Hospitality"
              detail="3 connected locations"
              status={{ label: "Google connection", value: "Healthy" }}
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <MetricCard
            title="Response rate"
            value="94.8%"
            detail="Up 4.2 points"
            icon={Activity}
          />
          <MetricCard
            title="Reviews awaiting reply"
            value="12"
            detail="Across 3 locations"
            icon={Inbox}
          />
        </div>
        <Card className="bg-card">
          <CardHeader>
            <CardTitle>Location performance</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead className="text-right">Response rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Central</TableCell>
                  <TableCell>4.8</TableCell>
                  <TableCell className="text-right font-mono">94.8%</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Riverside</TableCell>
                  <TableCell>4.6</TableCell>
                  <TableCell className="text-right font-mono">91.2%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Priya Sharma</CardTitle>
                <div className="mt-1 flex items-center gap-2">
                  <Stars value={5} />
                  <StatusBadge status="awaiting_approval" />
                </div>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                2d
              </span>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="rounded-(--nr-radius-field) bg-muted p-4">
              <p className="text-xs font-semibold text-muted-foreground">
                Customer review
              </p>
              <p className="mt-2">
                The team made our stay effortless and welcoming.
              </p>
            </div>
            <div className="rounded-(--nr-radius-field) bg-accent p-4 text-accent-foreground">
              <p className="text-xs font-semibold">Assisted public reply</p>
              <p className="mt-2">
                Thank you, Priya. We are delighted the team made you feel
                welcome.
              </p>
              <p className="mt-3 text-xs font-semibold">
                Verified · awaiting approval
              </p>
            </div>
          </CardContent>
        </Card>
      </Section>

      <footer className="pb-4 font-mono text-xs text-muted-foreground">
        Reduced motion removes lift and nonessential duration · no nested glass
        · no-blur fallback included
      </footer>
    </main>
  )
}
