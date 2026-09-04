import { Plus } from "lucide-react"

import { ToastDemo } from "@/app/design-system/toast-demo"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem } from "@/components/ui/combobox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Breadcrumbs } from "@/components/ui/breadcrumb"
import { CapabilityBanner } from "@/components/editors/capability-banner"
import { ChangeDiff } from "@/components/editors/change-diff"
import { EditorFooterDemo } from "@/app/design-system/editor-footer-demo"
import { KpiTile } from "@/components/ui/kpi-tile"
import { StatusPill } from "@/components/ui/status-pill"
import { Stepper } from "@/components/ui/stepper"
import { STATUS_TONES } from "@/lib/ui/status-tone"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type SectionTitle =
  | "Foundations"
  | "Typography"
  | "Spacing and radius"
  | "Primitives"
  | "Compositions"

const SECTION_IDS: Record<SectionTitle, string> = {
  Foundations: "foundations",
  Typography: "typography",
  "Spacing and radius": "spacing-and-radius",
  Primitives: "primitives",
  Compositions: "compositions",
}

const SORT_ITEMS: Record<string, string> = {
  updated_desc: "Most recent",
  rating_desc: "Highest rated",
  rating_asc: "Lowest rated",
}

const DESIGN_SYSTEM_LOCATIONS = ["Riverside", "Old Crown"] as const

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
    <main className="mx-auto flex min-h-svh w-full max-w-(--np-page-max-width) flex-col gap-(--np-gap-section) px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          NabaPresence design system
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every specimen below reads the same tokens the app does, so a role
          that drifts shows up here first. Foundations, type and shape come
          from `app/globals.css`; the pairs are measured, not asserted in a
          comment.
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
              className={`rounded-(--np-radius-panel) border p-5 ${theme.className}`}
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
              className="border bg-card p-4"
              style={{
                borderRadius: `var(--np-radius-${["control", "field", "card", "panel"][index]})`,
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
          Tailwind&apos;s default scale by decision (spec §7) · 12px card gap
          · 16px section gap · 14px card padding
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

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Field &amp; Input</h3>
          <div className="grid max-w-md gap-4">
            <Field>
              <FieldLabel>Business name</FieldLabel>
              <Input defaultValue="Old Crown" />
              <FieldDescription>
                Shown on your Google profile.
              </FieldDescription>
            </Field>
            <Field error="Enter a business name.">
              <FieldLabel>Business name</FieldLabel>
              <Input />
              <FieldError />
            </Field>
            <Input aria-label="Search reviews" placeholder="Search reviews" />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Textarea</h3>
          <Textarea
            aria-label="Reply draft"
            defaultValue="Thank you for the kind words — we're glad you enjoyed your stay."
            className="max-w-md"
          />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Dialog</h3>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              Edit hours
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit hours</DialogTitle>
                <DialogDescription>
                  Weekly schedule for this location.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Alert dialog</h3>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" />}>
              Discard your edits?
            </AlertDialogTrigger>
            <AlertDialogContent aria-label="Discard your edits?">
              <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
              <AlertDialogDescription>
                Regenerating replaces your unsaved changes with a new draft.
                This cannot be undone.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" size="sm" />}>
                  Keep editing
                </AlertDialogClose>
                <Button size="sm">Discard and regenerate</Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Sheet</h3>
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>
              Open menu
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription>Navigate the app.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Toast</h3>
          <ToastDemo />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Tabs</h3>
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTab value="all">All reviews</TabsTab>
              <TabsTab value="needs_reply">Needs reply</TabsTab>
              <TabsTab value="published">Published</TabsTab>
            </TabsList>
            <TabsPanel value="all">Every review across connected locations.</TabsPanel>
            <TabsPanel value="needs_reply">Reviews waiting on a reply.</TabsPanel>
            <TabsPanel value="published">Replies already published.</TabsPanel>
          </Tabs>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Select</h3>
          <Select defaultValue="updated_desc" items={SORT_ITEMS}>
            <SelectTrigger aria-label="Sort reviews" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated_desc">Most recent</SelectItem>
              <SelectItem value="rating_desc">Highest rated</SelectItem>
              <SelectItem value="rating_asc">Lowest rated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Combobox</h3>
          {/* This page is a server component: `items` must stay plain, serialisable
              data (no `itemToStringLabel` callback), since a function prop cannot
              cross the server/client boundary into this "use client" primitive. */}
          <Combobox items={DESIGN_SYSTEM_LOCATIONS}>
            <ComboboxInput placeholder="All locations" aria-label="Filter by location" />
            <ComboboxContent>
              {DESIGN_SYSTEM_LOCATIONS.map((location) => (
                <ComboboxItem key={location} value={location}>
                  {location}
                </ComboboxItem>
              ))}
            </ComboboxContent>
          </Combobox>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Dropdown menu</h3>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              Review actions
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Delete published reply</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Avatar</h3>
          <div className="flex items-center gap-2">
            <Avatar>
              <AvatarFallback>ST</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>AN</AvatarFallback>
            </Avatar>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Empty</h3>
          <Empty
            title="No reviews yet"
            description="New Google reviews will appear here as they arrive."
          />
        </div>
      </Section>

      <Section title="Compositions">
        <p className="max-w-3xl text-sm text-muted-foreground">
          The pieces built for the agency rebuild. Each one exists because the
          same shape was being reinvented per screen.
        </p>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Status pill</h3>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Five tones, one vocabulary. Health, connection state, review
            situation and diff status all read from it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_TONES.map((tone) => (
              <StatusPill key={tone} tone={tone}>
                {tone}
              </StatusPill>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">KPI tile</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiTile label="Reviews received" value="128" hint="Last 30 days" />
            <KpiTile label="Average rating" value="4.6" hint="Last 30 days" />
            <KpiTile label="Response rate" value="92%" hint="Last 30 days" />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Stepper</h3>
          <Stepper
            steps={[
              { id: "agency", label: "Agency", state: "done" },
              { id: "client", label: "Client", state: "done" },
              { id: "connect", label: "Connect Google", state: "current" },
              { id: "locations", label: "Locations", state: "todo" },
            ]}
          />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Change diff</h3>
          <p className="max-w-3xl text-sm text-muted-foreground">
            What every Google write shows before it happens. A conflict row
            says Google moved the field after the draft started.
          </p>
          <ChangeDiff
            caption="Changes to publish for Old Crown"
            rows={[
              {
                field: "Phone",
                before: "01223 277 217",
                after: "01223 277 218",
              },
              {
                field: "Description",
                before: "A riverside pub.",
                after: "A riverside pub with rooms.",
                state: "conflict",
              },
            ]}
          />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Editor footer</h3>
          <p className="max-w-3xl text-sm text-muted-foreground">
            One primary action. The gate note carries the reason whenever it is
            disabled.
          </p>
          <EditorFooterDemo />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Capability banner</h3>
          <CapabilityBanner
            tone="read_only"
            title="You can look, but not change this"
            description="Only owners and admins can edit this location."
          />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-title font-semibold">Breadcrumb</h3>
          <Breadcrumbs
            crumbs={[
              { label: "Clients", href: "/clients" },
              { label: "Old Crown Group", href: "/clients/demo" },
              { label: "Old Crown Girton" },
            ]}
          />
        </div>
      </Section>
    </main>
  )
}
