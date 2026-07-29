"use client"

import { Activity, Inbox, Moon } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"

type SectionTitle =
  | "Foundations"
  | "Typography"
  | "Spacing and radius"
  | "Elevation and glass"
  | "Controls"
  | "Status and feedback"
  | "Product compositions"

const SWATCHES = [
  ["background", "bg-background", "#FFFFFF", "foreground 16.10:1"],
  ["primary", "bg-primary", "#1A73E8", "white 4.51:1"],
  ["accent", "bg-accent", "#E8F0FE", "accent text 5.57:1"],
  ["success", "bg-success", "#146C2E", "white 6.53:1"],
  ["warning", "bg-warning", "#F9AB00", "label required"],
  ["destructive", "bg-destructive", "#B3261E", "white 6.54:1"],
] as const

function Section({
  title,
  children,
}: {
  title: SectionTitle
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={`section-${title}`} className="flex flex-col gap-4">
      <h2
        id={`section-${title}`}
        className="font-heading text-[15px] font-semibold"
      >
        {title}
      </h2>
      {children}
      <Separator />
    </section>
  )
}

export default function Page() {
  const { resolvedTheme, setTheme } = useTheme()

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
            Production foundations and shipping compositions for auditable public
            replies. Contrast evidence shows measured light-theme pairs; press
            <kbd className="mx-1 rounded-(--nr-radius-tag) border bg-muted px-1.5 font-mono text-[11px]">
              d
            </kbd>
            or use the theme control to inspect both themes.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Moon data-icon="inline-start" />
          Toggle theme
        </Button>
      </header>

      <Section title="Foundations">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {SWATCHES.map(([token, colour, hex, evidence]) => (
            <div key={token} className="flex min-w-0 flex-col gap-2">
              <div className={`h-14 rounded-(--nr-radius-field) border ${colour}`} />
              <div className="min-w-0 text-xs">
                <p className="font-semibold">{token}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{hex}</p>
                <p className="text-[11px] text-muted-foreground">{evidence}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <Card><CardContent className="grid gap-5 md:grid-cols-2">
          <div><p className="text-xs text-muted-foreground">Geist heading</p><p className="font-heading text-[22px] font-semibold">Clear review operations</p></div>
          <div><p className="text-xs text-muted-foreground">Geist body</p><p className="text-[13.5px] leading-[1.45]">Human approval stays visible from review to published reply.</p></div>
          <div><p className="text-xs text-muted-foreground">Geist Mono numerals</p><p className="font-mono text-2xl font-semibold">94.8% · 00:42</p></div>
        </CardContent></Card>
      </Section>

      <Section title="Spacing and radius">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[["Controls","12px"],["Fields","14px"],["Cards","18px"],["Panels","20px"]].map(([name,value], index) => (
            <div key={name} className="border bg-card p-4 shadow-(--nr-shadow-card)" style={{ borderRadius: `var(--nr-radius-${["control","field","card","panel"][index]})` }}>
              <p className="font-semibold">{name}</p><p className="font-mono text-xs text-muted-foreground">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">2px base scale · 14px card gap · 22px section gap · 18px card padding</p>
      </Section>

      <Section title="Elevation and glass">
        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardHeader><CardTitle>Opaque reading surface</CardTitle></CardHeader><CardContent>Review prose, forms, tables and overlays remain opaque.</CardContent></Card>
          <Card className="bg-[var(--nr-surface-card-translucent)] backdrop-blur-xl"><CardHeader><CardTitle>Light translucency</CardTitle></CardHeader><CardContent>Reserved for business context and metrics.</CardContent></Card>
          <div className="rounded-(--nr-radius-shell) border border-[var(--nr-surface-glass-border)] bg-[var(--nr-surface-glass-strong)] p-(--nr-panel-pad) shadow-(--nr-shadow-float) backdrop-blur-xl"><p className="font-semibold">Strong glass</p><p className="text-sm text-muted-foreground">Floating navigation chrome only. High-opacity fallback ships when blur is unavailable.</p></div>
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap gap-2"><Button>Publish reply</Button><Button variant="secondary">Save draft</Button><Button variant="outline">Regenerate</Button><Button variant="destructive">Delete</Button><Button disabled>Pending</Button></div>
        <Card className="max-w-2xl"><CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2"><Label htmlFor="proof-name">Location</Label><Input id="proof-name" defaultValue="Lapen Inn — Central" /></div>
          <div className="flex items-center gap-2 pt-6"><Switch id="proof-approval" aria-label="Require approval" defaultChecked /><Label htmlFor="proof-approval">Require approval</Label></div>
          <div className="flex flex-col gap-2 sm:col-span-2"><Label htmlFor="proof-reply">Reply draft</Label><Textarea id="proof-reply" defaultValue="Thank you for sharing your experience." /></div>
        </CardContent></Card>
      </Section>

      <Section title="Status and feedback">
        <div className="flex flex-wrap gap-2"><StatusBadge status="published" /><StatusBadge status="awaiting_approval" /><StatusBadge status="escalated" /><StatusBadge status="needs_reply" /></div>
        <div className="grid gap-4 md:grid-cols-2"><Alert><Activity /><AlertTitle>Sync complete</AlertTitle><AlertDescription>24 reviews are ready for triage.</AlertDescription></Alert><Alert variant="destructive"><AlertTitle>Connection needs attention</AlertTitle><AlertDescription>Reconnect to resume review sync.</AlertDescription></Alert></div>
        <div className="grid gap-4 md:grid-cols-2"><div><Label>Reply rate — 62%</Label><Progress value={62} aria-label="Reply rate" className="mt-2" /></div><div className="flex items-center gap-3"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-2/3" /></div></div></div>
        <EmptyData message="Connect a location to begin receiving reviews." />
      </Section>

      <Section title="Product compositions">
        <BusinessContext organisationName="Naba Review Hospitality" detail="3 connected locations" status={{ label: "Google connection", value: "Healthy" }} />
        <div className="grid gap-4 md:grid-cols-2"><MetricCard title="Response rate" value="94.8%" detail="Up 4.2 points" icon={Activity} /><MetricCard title="Reviews awaiting reply" value="12" detail="Across 3 locations" icon={Inbox} /></div>
        <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle>Priya Sharma</CardTitle><div className="mt-1 flex items-center gap-2"><Stars value={5} /><StatusBadge status="awaiting_approval" /></div></div><span className="font-mono text-xs text-muted-foreground">2d</span></div></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div className="rounded-(--nr-radius-field) bg-muted p-4"><p className="text-xs font-semibold text-muted-foreground">Customer review</p><p className="mt-2">The team made our stay effortless and welcoming.</p></div><div className="rounded-(--nr-radius-field) bg-accent p-4 text-accent-foreground"><p className="text-xs font-semibold">Assisted public reply</p><p className="mt-2">Thank you, Priya. We are delighted the team made you feel welcome.</p><p className="mt-3 text-xs font-semibold">Verified · awaiting approval</p></div></CardContent></Card>
      </Section>

      <footer className="pb-4 font-mono text-xs text-muted-foreground">Reduced motion removes lift and nonessential duration · no nested glass · no-blur fallback included</footer>
    </main>
  )
}
