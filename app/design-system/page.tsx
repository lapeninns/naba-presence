import { MoreVertical, Star, Trash2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/* Proof sheet for the NabaReview design system: every token rendered on a real
   shadcn surface so the palette can be checked by eye in both themes, not just
   asserted in a spec. Press `d` to toggle light/dark. */

type Swatch = {
  token: string
  hex: string
  /** Measured WCAG ratio for the pair that actually ships, where one applies. */
  note?: string
  /** Tailwind classes painting the chip. */
  chip: string
}

const SURFACES: Swatch[] = [
  { token: "background", hex: "#FFFFFF", chip: "bg-background border-border" },
  { token: "card", hex: "#FFFFFF", chip: "bg-card border-border" },
  { token: "muted", hex: "#F8F9FA", chip: "bg-muted border-border" },
  { token: "secondary", hex: "#F1F3F4", chip: "bg-secondary border-border" },
  { token: "input (fill)", hex: "#E8EAED", chip: "bg-input border-border" },
  { token: "border", hex: "#DADCE0", chip: "bg-border border-transparent" },
]

const TEXT: Swatch[] = [
  {
    token: "foreground",
    hex: "#202124",
    note: "16.10:1",
    chip: "bg-foreground border-transparent",
  },
  {
    token: "muted-foreground",
    hex: "#5F6368",
    note: "6.05:1",
    chip: "bg-muted-foreground border-transparent",
  },
]

const BRAND: Swatch[] = [
  {
    token: "primary",
    hex: "#1A73E8",
    note: "4.51:1 w/ white",
    chip: "bg-primary border-transparent",
  },
  {
    token: "accent",
    hex: "#E8F0FE",
    chip: "bg-accent border-border",
  },
  {
    token: "accent-foreground",
    hex: "#0B57D0",
    note: "5.57:1 on accent",
    chip: "bg-accent-foreground border-transparent",
  },
  {
    token: "ring",
    hex: "#1A73E8",
    note: "4.51:1",
    chip: "bg-ring border-transparent",
  },
]

const SEMANTIC: Swatch[] = [
  {
    token: "destructive",
    hex: "#B3261E",
    note: "6.54:1 as text",
    chip: "bg-destructive border-transparent",
  },
  {
    token: "success",
    hex: "#146C2E",
    note: "6.53:1 as text",
    chip: "bg-success border-transparent",
  },
  {
    token: "warning",
    hex: "#F9AB00",
    note: "fill only",
    chip: "bg-warning border-transparent",
  },
  {
    token: "rating",
    hex: "#FBBC04",
    note: "decorative",
    chip: "bg-rating border-transparent",
  },
]

const CHARTS: Swatch[] = [
  { token: "chart-1", hex: "#4285F4", chip: "bg-chart-1 border-transparent" },
  { token: "chart-2", hex: "#EA4335", chip: "bg-chart-2 border-transparent" },
  { token: "chart-3", hex: "#FBBC04", chip: "bg-chart-3 border-transparent" },
  { token: "chart-4", hex: "#34A853", chip: "bg-chart-4 border-transparent" },
  { token: "chart-5", hex: "#12B5CB", chip: "bg-chart-5 border-transparent" },
]

function SwatchGrid({ title, items }: { title: string; items: Swatch[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((s) => (
          <div key={s.token} className="flex flex-col gap-1.5">
            <div className={`h-12 rounded-xl border ${s.chip}`} />
            <div className="flex flex-col">
              <span className="text-xs font-medium">{s.token}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {s.hex}
              </span>
              {s.note ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {s.note}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-heading text-lg font-medium tracking-tight">
          {title}
        </h2>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
      <Separator />
    </section>
  )
}

function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
      aria-label={`${value} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={
            i <= value
              ? "size-4 fill-rating text-rating"
              : "size-4 text-muted-foreground/40"
          }
        />
      ))}
    </span>
  )
}

const RATING_FILTERS = [
  { value: "all", label: "All ratings" },
  { value: "low", label: "1–2 stars" },
  { value: "high", label: "4–5 stars" },
]

const REVIEWS = [
  { name: "Priya Sharma", rating: 5, status: "Replied", days: "2d" },
  { name: "Tom Okafor", rating: 4, status: "Awaiting reply", days: "3d" },
  { name: "Lena Fischer", rating: 2, status: "Escalated", days: "5d" },
  { name: "Marco Silva", rating: 5, status: "Replied", days: "1w" },
]

export default function Page() {
  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-10 p-6 md:p-10">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-medium tracking-tight">
            NabaReview design system
          </h1>
          <Badge variant="secondary">base-rhea</Badge>
          <Badge variant="secondary">Base UI</Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          shadcn/ui component shapes, Google Business Profile palette. Every
          token below is a Google Material hex converted to oklch and measured
          against WCAG AA. Press{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px]">
            d
          </kbd>{" "}
          to check both themes.
        </p>
      </header>

      <Section
        title="Palette"
        hint="Hex values are the light-theme source colours; ratios are the pairs that actually ship."
      >
        <div className="flex flex-col gap-6">
          <SwatchGrid title="Surfaces" items={SURFACES} />
          <SwatchGrid title="Text" items={TEXT} />
          <SwatchGrid title="Brand" items={BRAND} />
          <SwatchGrid title="Semantic" items={SEMANTIC} />
          <SwatchGrid title="Charts" items={CHARTS} />
        </div>
      </Section>

      <Section
        title="Buttons"
        hint="Hover the primary button: it darkens via color-mix instead of the stock lightening, which fell to 3.27:1."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button>Reply</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs">xs</Button>
          <Button size="sm">sm</Button>
          <Button size="default">default</Button>
          <Button size="lg">lg</Button>
          <Button disabled>Disabled</Button>
          <Toggle>Toggle</Toggle>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Escalated</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="ghost">Ghost</Badge>
        </div>
      </Section>

      <Section
        title="Review card"
        hint="The composition this palette exists for — rating token, status badge, reply affordance."
      >
        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex items-start gap-3">
              <Avatar>
                <AvatarFallback>PS</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle className="text-base">Priya Sharma</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={5} />
                  <span className="text-xs text-muted-foreground">
                    2 days ago
                  </span>
                  <Badge variant="secondary">Awaiting reply</Badge>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label="Review actions"
                    >
                      <MoreVertical />
                    </Button>
                  }
                />
                {/* base-rhea sizes menus to `w-(--anchor-width)`, so an icon
                    trigger yields a cramped menu unless a width is given. */}
                <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuItem>Draft a reply</DropdownMenuItem>
                  <DropdownMenuItem>Mark as handled</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    <Trash2 />
                    Report review
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <CardDescription className="text-sm text-foreground">
              Stayed two nights and the front desk could not have been kinder.
              The room was spotless and breakfast was genuinely good.
            </CardDescription>
            <Textarea placeholder="Write a reply…" rows={3} />
          </CardContent>
          <CardFooter className="gap-2">
            <Button>Post reply</Button>
            <Button variant="ghost">Save draft</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section
        title="Form controls"
        hint="base-rhea draws fields with a tinted fill (bg-input/50) and a transparent border — the boundary is deliberately quiet. Focus to see the ring."
      >
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="loc">Location</Label>
            <Input id="loc" placeholder="Lapen Inn — Central" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="filter">Rating filter</Label>
            {/* Base UI needs `items` for SelectValue to render the label
                rather than the raw value. */}
            <Select defaultValue="all" items={RATING_FILTERS}>
              <SelectTrigger id="filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATING_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invalid">Invalid state</Label>
            <Input id="invalid" aria-invalid defaultValue="not-an-email" />
          </div>
          <div className="flex flex-col justify-end gap-3">
            <div className="flex items-center gap-2">
              <Checkbox id="auto" defaultChecked />
              <Label htmlFor="auto">Auto-draft replies</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="notify" defaultChecked />
              <Label htmlFor="notify">Email digest</Label>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Feedback">
        <div className="flex max-w-2xl flex-col gap-4">
          <Alert>
            <AlertTitle>Sync complete</AlertTitle>
            <AlertDescription>
              Pulled 24 new reviews from Google Business Profile.
            </AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Token expired</AlertTitle>
            <AlertDescription>
              Reconnect the Google account to resume syncing.
            </AlertDescription>
          </Alert>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              Reply rate — 62%
            </span>
            <Progress value={62} />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Data"
        hint="Rating token in a dense surface, plus semantic status colours."
      >
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unanswered">Unanswered</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {REVIEWS.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Stars value={r.rating} />
                    </TableCell>
                    <TableCell>
                      {r.status === "Replied" ? (
                        <span className="text-success">{r.status}</span>
                      ) : r.status === "Escalated" ? (
                        <span className="text-destructive">{r.status}</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {r.status}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {r.days}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="unanswered">
            <p className="py-6 text-sm text-muted-foreground">
              Two reviews awaiting a reply.
            </p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Overlay" hint="Tooltip and menu surfaces.">
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="outline">Tooltip</Button>}
            />
            <TooltipContent>Synced 4 minutes ago</TooltipContent>
          </Tooltip>
        </div>
      </Section>

      <footer className="pb-4 font-mono text-xs text-muted-foreground">
        Tokens in app/globals.css · rationale in docs/specs/
      </footer>
    </div>
  )
}
