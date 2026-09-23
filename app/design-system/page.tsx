import { notFound } from "next/navigation"

import {
  Check,
  ChevronDown,
  CircleAlert,
  Inbox,
  MoreHorizontal,
  Pencil,
  Unlink,
} from "lucide-react"

import { CommandDemo } from "@/app/design-system/command-demo"
import { ContrastEvidence } from "@/app/design-system/contrast-evidence"
import {
  CounterTextareaDemo,
  PendingButtonDemo,
  RemovableChipDemo,
  TagInputDemo,
  ThemeToggleDemo,
  ValidationDemo,
} from "@/app/design-system/interactive-demos"
import { ToastDemo } from "@/app/design-system/toast-demo"
import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
  Banner,
} from "@/components/ui/alert"
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
import { ChartDataTable, ChartLegend } from "@/components/ui/chart"
import { Checkbox } from "@/components/ui/checkbox"
import { ChipRow, ToggleChip } from "@/components/ui/chip"
import { ChoiceCard } from "@/components/ui/choice-card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DiffView } from "@/components/ui/diff-view"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty } from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { KpiTile } from "@/components/ui/kpi-tile"
import { Lifecycle } from "@/components/ui/lifecycle"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Meter, Progress } from "@/components/ui/progress"
import { PublishSteps } from "@/components/ui/publish-steps"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { SectionHeader } from "@/components/ui/section-header"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Stars } from "@/components/ui/stars"
import { StatusPill } from "@/components/ui/status-pill"
import { Stepper } from "@/components/ui/stepper"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { Timeline } from "@/components/ui/timeline"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getServerEnv } from "@/lib/server/env"
import { cn } from "@/lib/utils"

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

const TOC: Array<[string, string]> = [
  ["Foundations", "section-foundations"],
  ["Type", "section-typography"],
  ["Spacing", "section-spacing-and-radius"],
  ["Controls", "ds-controls"],
  ["Status", "ds-status"],
  ["Data", "ds-data"],
  ["Progress", "ds-flow"],
  ["States", "ds-states"],
  ["Overlays", "ds-overlays"],
  ["Forms", "ds-forms"],
  ["Compositions", "section-compositions"],
]

const PRINCIPLES: Array<[string, string]> = [
  [
    "The customer’s words are the largest readable text",
    "Reviews set in the reading serif at 17/28; chrome stays at 13–14px.",
  ],
  [
    "State is always labelled",
    "Pills carry words, not just colour. A dot never stands alone.",
  ],
  [
    "Nothing claims success before Google confirms",
    "“Sent to Google” comes before “Live on Google”.",
  ],
  [
    "One primary action per surface",
    "The accent solid appears once per viewport; other routes are secondary or ghost.",
  ],
  [
    "Every workspace reflows by its own width",
    "Container queries, not the viewport, decide columns — 320px to 1920px.",
  ],
]

// Spelled out so Tailwind sees every class.
const SWATCH_GROUPS: Array<[string, Array<[string, string, string]>]> = [
  [
    "Neutrals",
    [
      ["canvas", "bg-canvas", "Page background"],
      ["surface", "bg-surface", "Cards, fields"],
      ["surface-alt", "bg-surface-alt", "Sunken rows, rails, table head"],
      ["fill", "bg-fill", "Hover fill, skeleton, tracks"],
      ["line", "bg-line", "Hairlines"],
      ["line-strong", "bg-line-strong", "Control boundary (3:1)"],
      ["ink", "bg-ink", "Body text"],
      ["ink-secondary", "bg-ink-secondary", "Strong secondary text"],
      ["ink-muted", "bg-ink-muted", "Captions, meta"],
    ],
  ],
  [
    "Accent",
    [
      ["primary", "bg-primary", "Primary button, current marker"],
      ["accent-hover", "bg-accent-hover", "Primary hover"],
      ["accent-ink", "bg-accent-ink", "Selected text, links"],
      ["accent-tint", "bg-accent-tint", "Selected background"],
    ],
  ],
  [
    "Status",
    [
      ["success-ink", "bg-success-ink", "Success text"],
      ["success-tint", "bg-success-tint", "Success fill"],
      ["success-solid", "bg-success-solid", "Success dot"],
      ["warning-ink", "bg-warning-ink", "Warning text"],
      ["warning-tint", "bg-warning-tint", "Warning fill"],
      ["warning-solid", "bg-warning-solid", "Warning dot"],
      ["danger-ink", "bg-danger-ink", "Error text"],
      ["danger-tint", "bg-danger-tint", "Error fill"],
      ["danger-solid", "bg-danger-solid", "Danger button, error dot"],
      ["info-ink", "bg-info-ink", "Info text"],
      ["info-tint", "bg-info-tint", "Info fill"],
      ["info-solid", "bg-info-solid", "Info dot"],
      ["rating", "bg-rating", "Rating stars"],
    ],
  ],
  [
    "Counter-surface and charts",
    [
      ["charcoal", "bg-charcoal", "Action bar, toasts"],
      ["ink-on-charcoal", "bg-ink-on-charcoal", "Text on charcoal"],
      [
        "ink-muted-on-charcoal",
        "bg-ink-muted-on-charcoal",
        "Secondary on charcoal",
      ],
      ["chart-1", "bg-chart-1", "Series 1"],
      ["chart-2", "bg-chart-2", "Series 2"],
      ["chart-3", "bg-chart-3", "Baseline series"],
    ],
  ],
]

const TYPE_ROLES: Array<[string, string, string]> = [
  [
    "Caption · 12/16",
    "text-caption text-ink-muted",
    "Synced 12 min ago · Sample figures",
  ],
  [
    "Meta · mono 12",
    "font-mono text-caption text-ink-muted",
    "PROVIDER_PERMISSION_DENIED · 17 Sep, 18:02",
  ],
  [
    "Eyebrow · mono 11.5",
    "font-mono text-[11.5px] font-medium tracking-[0.06em] text-ink-muted uppercase",
    "The Bell · LI-02",
  ],
  ["UI · 13/20", "text-ui", "Buttons, table cells, navigation"],
  [
    "Body · 14/22",
    "text-body",
    "Replies publish to Google as soon as they pass the checks.",
  ],
  ["Title · 16/24", "text-title font-semibold", "Reply performance"],
  ["Section · 18/26", "text-section font-semibold", "Google logins"],
  [
    "Page · serif 22–28",
    "font-display text-page-title font-semibold",
    "Reply policy",
  ],
  [
    "Display · serif 28–36",
    "font-display text-display font-semibold",
    "Everything is handled",
  ],
  [
    "Reading · serif 17/28",
    "font-reading text-reading",
    "Sunday lunch took almost an hour to arrive and the roast potatoes were cold by the time they did.",
  ],
  [
    "Figures · mono tabular",
    "font-mono tabular-nums",
    "1,234 · 10 h 52 min · 4.4",
  ],
]

const SPACE = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const
const SPACE_WIDTH: Record<(typeof SPACE)[number], string> = {
  1: "w-1",
  2: "w-2",
  3: "w-3",
  4: "w-4",
  5: "w-5",
  6: "w-6",
  8: "w-8",
  10: "w-10",
  12: "w-12",
}
const RADII: Array<[string, string]> = [
  ["tag 6", "rounded-(--np-radius-tag)"],
  ["control 8", "rounded-(--np-radius-control)"],
  ["card 12", "rounded-(--np-radius-card)"],
  ["modal 16", "rounded-(--np-radius-modal)"],
  ["pill", "rounded-(--np-radius-pill)"],
]

const SAMPLE_REVIEWS = [5, 8, 6, 9, 12, 14, 7]
const SAMPLE_REPLIED = [5, 7, 6, 8, 10, 11, 4]
const SAMPLE_MAX = 14
// Spelled out so Tailwind sees every height class.
const BAR_H: Record<number, string> = {
  0: "h-0",
  1: "h-[7%]",
  2: "h-[14%]",
  3: "h-[21%]",
  4: "h-[29%]",
  5: "h-[36%]",
  6: "h-[43%]",
  7: "h-[50%]",
  8: "h-[57%]",
  9: "h-[64%]",
  10: "h-[71%]",
  11: "h-[79%]",
  12: "h-[86%]",
  13: "h-[93%]",
  14: "h-full",
}

function Section({
  title,
  description,
  children,
}: {
  title: SectionTitle
  description?: React.ReactNode
  children: React.ReactNode
}) {
  const id = `section-${SECTION_IDS[title]}`
  return (
    <section
      aria-labelledby={id}
      className="flex scroll-mt-4 flex-col gap-6 border-t border-line pt-8 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-section font-semibold text-ink">
          {title}
        </h2>
        {description ? (
          <p className="max-w-3xl text-ui text-ink-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

/** One named specimen: an h3, a caption note, and the thing itself. */
function Specimen({
  title,
  note,
  id,
  children,
}: {
  title: string
  note?: React.ReactNode
  id?: string
  children: React.ReactNode
}) {
  return (
    <div id={id} className="flex min-w-0 scroll-mt-4 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-title font-semibold text-ink">{title}</h3>
        {note ? <p className="text-caption text-ink-muted">{note}</p> : null}
      </div>
      {children}
    </div>
  )
}

/** The reference `.demo` panel. */
function Demo({
  column = false,
  sunken = false,
  className,
  children,
}: {
  column?: boolean
  sunken?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-3 rounded-(--np-radius-card) border border-line p-5",
        column && "flex-col flex-nowrap items-stretch",
        sunken ? "bg-canvas" : "bg-surface",
        className
      )}
    >
      {children}
    </div>
  )
}

/** The primitives most affected by the theme, drawn together. */
function ThemeSampler() {
  return (
    <div className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-canvas p-4 text-ink">
      <div className="flex flex-wrap items-center gap-2">
        <Button>Publish to Google</Button>
        <Button variant="secondary">Save draft</Button>
        <Button variant="danger-outline">Discard</Button>
        <StatusPill tone="ok">Live on Google</StatusPill>
        <StatusPill tone="warn">Awaiting approval</StatusPill>
        <StatusPill tone="bad">Publish failed</StatusPill>
      </div>
      <Field>
        <FieldLabel>Business name</FieldLabel>
        <Input defaultValue="The Bell" />
      </Field>
      <ActionBar
        sticky={false}
        safeArea={false}
        label="Sample action bar"
        status={
          <span>
            <strong>1 change not on Google</strong>{" "}
            <ActionBarMuted>· Saved here</ActionBarMuted>
          </span>
        }
        actions={
          <>
            <Button variant="ghost-dark" size="sm">
              Discard
            </Button>
            <Button size="sm">Review changes</Button>
          </>
        }
      />
    </div>
  )
}

export const metadata = { title: "Design system · NabaPresence" }

// Rendered per request, never prerendered. DESIGN_SYSTEM_EVIDENCE_ENABLED is a
// serve-time control, so a build-time decision would freeze whichever value
// happened to be set when `next build` ran. Forcing dynamic also moves
// ContrastEvidence's cwd-relative read of app/globals.css onto the request
// path.
export const dynamic = "force-dynamic"

export default function Page() {
  if (!getServerEnv().DESIGN_SYSTEM_EVIDENCE_ENABLED) notFound()
  return (
    <TooltipProvider>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex min-h-svh w-full max-w-[1080px] flex-col gap-10 px-(--np-page-pad-x) py-(--np-page-pad-y) pb-16 outline-none"
      >
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
            <p className="font-mono text-[11.5px] font-medium tracking-[0.06em] text-ink-muted uppercase">
              Rendered evidence · components/ui
            </p>
            <h1 className="font-display text-page-title font-semibold text-balance text-ink">
              NabaPresence design system
            </h1>
            <p className="max-w-[70ch] text-body text-ink-muted">
              Every token and component below is rendered live from the shipping
              primitives, so this page is proof rather than a description.
              Switch the theme to check both; contrast ratios are measured from
              app/globals.css.
            </p>
          </div>
          <ThemeToggleDemo />
        </header>

        <nav
          aria-label="On this page"
          className="sticky top-0 z-10 -my-2 bg-canvas py-2"
        >
          <ChipRow>
            {TOC.map(([label, id]) => (
              <a
                key={id}
                href={`#${id}`}
                className="inline-flex h-8 shrink-0 items-center rounded-(--np-radius-pill) border border-line bg-surface px-3 text-ui font-medium whitespace-nowrap text-ink no-underline focus-halo hover:border-line-strong hover:bg-surface-alt pointer-coarse:h-10"
              >
                {label}
              </a>
            ))}
          </ChipRow>
        </nav>

        <Section
          title="Foundations"
          description="What every screen is checked against, and the colour roles it is built from."
        >
          <ol className="grid list-none [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
            {PRINCIPLES.map(([title, body], index) => (
              <li
                key={title}
                className="flex flex-col gap-1 rounded-(--np-radius-card) bg-surface-alt p-4"
              >
                <span className="font-mono text-caption font-semibold text-accent-ink">
                  0{index + 1}
                </span>
                <strong className="text-title font-semibold">{title}</strong>
                <span className="text-ui text-ink-muted">{body}</span>
              </li>
            ))}
          </ol>

          {SWATCH_GROUPS.map(([group, swatches]) => (
            <Specimen key={group} title={group}>
              <div className="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,160px),1fr))] gap-3">
                {swatches.map(([name, className, role]) => (
                  <div
                    key={name}
                    className="flex flex-col overflow-hidden rounded-(--np-radius-card) border border-line bg-surface"
                  >
                    <div
                      className={cn("h-14 border-b border-line", className)}
                    />
                    <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
                      <code className="font-mono text-caption font-semibold break-all">
                        {name}
                      </code>
                      <span className="text-caption text-ink-muted">
                        {role}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Specimen>
          ))}

          <Specimen
            title="Both themes"
            note="The same primitives in the dark theme, on a dark island, beside the current theme."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <ThemeSampler />
              <div className="dark rounded-(--np-radius-card)">
                <ThemeSampler />
              </div>
            </div>
          </Specimen>

          <Specimen
            title="Contrast"
            note="Text needs 4.5:1; large text and control boundaries 3:1. Measured from the shipping token file."
          >
            <ContrastEvidence />
          </Specimen>
        </Section>

        <Section
          title="Typography"
          description="System sans for the interface, a serif for page titles and the customer’s own words, mono for figures and codes."
        >
          <Card size="sm" className="@container gap-0 py-0">
            {TYPE_ROLES.map(([role, className, sample]) => (
              <div
                key={role}
                className="grid grid-cols-[minmax(120px,180px)_minmax(0,1fr)] items-baseline gap-4 border-b border-line px-4 py-2.5 last:border-0 @max-[560px]:grid-cols-1 @max-[560px]:gap-1"
              >
                <span className="font-mono text-caption text-ink-muted">
                  {role}
                </span>
                <span className={cn("min-w-0 break-words", className)}>
                  {sample}
                </span>
              </div>
            ))}
          </Card>
        </Section>

        <Section
          title="Spacing and radius"
          description="A 4px base. Radii grow with the size of the thing they round."
        >
          <div className="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
            <Demo column>
              {SPACE.map((step) => (
                <div
                  key={step}
                  className="grid grid-cols-[56px_48px_minmax(0,1fr)] items-center gap-3 font-mono text-caption"
                >
                  <span>{`space-${step}`}</span>
                  <span className="text-ink-muted">{step * 4}px</span>
                  <span
                    className={cn(
                      "h-3 rounded-[2px] bg-chart-1",
                      SPACE_WIDTH[step]
                    )}
                  />
                </div>
              ))}
            </Demo>
            <Demo column>
              <div className="flex flex-wrap gap-4">
                {RADII.map(([label, radius]) => (
                  <div
                    key={label}
                    className={cn(
                      "grid h-16 w-22 place-items-end justify-items-start border-[1.5px] border-line-strong bg-surface-alt p-1.5 font-mono text-[11px] text-ink-muted",
                      radius
                    )}
                  >
                    {label}
                  </div>
                ))}
              </div>
              <p className="text-caption text-ink-muted">
                Controls are 36px tall (30 small), and 44px on touch screens;
                chips and segments grow to 40px.
              </p>
            </Demo>
          </div>
        </Section>

        <Section
          title="Primitives"
          description="Every component in every state it can be in."
        >
          <div id="ds-controls" className="flex scroll-mt-4 flex-col gap-6">
            <Specimen
              title="Buttons"
              note="One primary per surface. Pending keeps a readable label."
            >
              <Demo>
                <Button>Publish to Google</Button>
                <Button variant="secondary">Save draft</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="danger">Delete from Google</Button>
                <Button variant="danger-outline">Discard edits</Button>
                <Button variant="tinted">Suggest a reply</Button>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="More actions"
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </Demo>
              <Demo>
                <Button size="sm">Small</Button>
                <Button>Default</Button>
                <Button size="lg">Large</Button>
                <Button disabled>Disabled</Button>
                <Button
                  variant="secondary"
                  disabledReason="Save a draft that passes every check first."
                >
                  Not ready (explains why)
                </Button>
                <Button variant="secondary" pending pendingLabel="Publishing…">
                  Publish
                </Button>
                <PendingButtonDemo />
              </Demo>
            </Specimen>

            <Specimen
              title="Fields"
              note="Visible labels; errors sit beside the field with a reason."
            >
              <Demo>
                <div className="grid w-full gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>Default</FieldLabel>
                    <Input placeholder="The Bell" />
                    <FieldDescription>
                      Hint text sits under the field.
                    </FieldDescription>
                  </Field>
                  <Field error="Enter a valid email address, like name@example.com.">
                    <FieldLabel>Invalid</FieldLabel>
                    <Input defaultValue="bell@" />
                    <FieldError />
                  </Field>
                  <Field>
                    <FieldLabel optional="read only">Disabled</FieldLabel>
                    <Input defaultValue="Managed by Google" disabled />
                  </Field>
                  <Field>
                    <FieldLabel>Search</FieldLabel>
                    <Input type="search" placeholder="Search reviews" />
                  </Field>
                  <Field>
                    <FieldLabel>Select</FieldLabel>
                    <Select defaultValue="28" items={{ "28": "Last 28 days", "90": "Last 90 days" }}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="28">Last 28 days</SelectItem>
                        <SelectItem value="90">Last 90 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel optional>Website</FieldLabel>
                    <Input type="url" placeholder="https://" />
                  </Field>
                  <CounterTextareaDemo />
                </div>
              </Demo>
            </Specimen>

            <Specimen
              title="Choices"
              note="Checkbox, radio, switch and choice cards."
            >
              <Demo className="items-start gap-8">
                <div className="flex flex-col gap-2">
                  <Checkbox defaultChecked label="Checked" />
                  <Checkbox label="Unchecked" />
                  <Checkbox indeterminate label="Indeterminate" />
                  <Checkbox disabled label="Disabled" />
                </div>
                <RadioGroup defaultValue="a" aria-label="Radio example">
                  <RadioGroupItem value="a">Selected</RadioGroupItem>
                  <RadioGroupItem value="b">Not selected</RadioGroupItem>
                  <RadioGroupItem value="c" disabled>
                    Disabled
                  </RadioGroupItem>
                </RadioGroup>
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2.5 text-body">
                    <Switch defaultChecked aria-labelledby="ds-sw-on" />
                    <span id="ds-sw-on">On</span>
                  </label>
                  <label className="flex items-center gap-2.5 text-body">
                    <Switch aria-labelledby="ds-sw-off" />
                    <span id="ds-sw-off">Off</span>
                  </label>
                  <label className="flex items-center gap-2.5 text-body text-ink-muted">
                    <Switch disabled aria-labelledby="ds-sw-dis" />
                    <span id="ds-sw-dis">Disabled</span>
                  </label>
                </div>
              </Demo>
              <RadioGroup
                defaultValue="low"
                aria-label="Approval policy"
                className="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3"
              >
                <ChoiceCard
                  value="low"
                  title="Approval for low ratings"
                  description="Selected card: accent border and tint."
                />
                <ChoiceCard
                  value="all"
                  title="Approval for every reply"
                  description="Unselected card."
                />
                <ChoiceCard
                  value="none"
                  title="No approval"
                  description="Disabled: owners only."
                  disabled
                />
              </RadioGroup>
            </Specimen>

            <Specimen
              title="Segmented and chips"
              note="Segmented picks one view; chips filter and scope. Pressed chips fill with ink."
            >
              <Demo>
                <SegmentedControl defaultValue="warm" aria-label="Tone">
                  <SegmentedControlItem value="warm">Warm</SegmentedControlItem>
                  <SegmentedControlItem value="concise">
                    Concise
                  </SegmentedControlItem>
                  <SegmentedControlItem value="empathetic">
                    Empathetic
                  </SegmentedControlItem>
                </SegmentedControl>
                <ToggleChip pressed count={5}>
                  Needs reply
                </ToggleChip>
                <ToggleChip count={2}>Approval</ToggleChip>
                <ToggleChip count={1} countTone="alert">
                  Failed
                </ToggleChip>
                <RemovableChipDemo />
              </Demo>
            </Specimen>
          </div>

          <div id="ds-status" className="flex scroll-mt-4 flex-col gap-4">
            <Specimen
              title="Status vocabulary"
              note="Pills always carry a word. Tone is a second cue, never the only one."
            >
              <Demo>
                <StatusPill tone="ok">Live on Google</StatusPill>
                <StatusPill tone="info">Publishing</StatusPill>
                <StatusPill tone="warn">Awaiting approval</StatusPill>
                <StatusPill tone="bad">Publish failed</StatusPill>
                <StatusPill tone="accent">Draft ready</StatusPill>
                <StatusPill tone="neutral" dashed>
                  No reply yet
                </StatusPill>
                <StatusPill tone="neutral">Neutral</StatusPill>
                <StatusPill tone="neutral" plain>
                  Plain
                </StatusPill>
                <StatusPill tone="outline">Outline</StatusPill>
              </Demo>
              <Demo>
                <span className="flex items-center gap-1.5 text-ui">
                  <StatusPill tone="healthy" variant="dot" />
                  Healthy
                </span>
                <span className="flex items-center gap-1.5 text-ui">
                  <StatusPill tone="attention" variant="dot" />
                  Needs attention
                </span>
                <span className="flex items-center gap-1.5 text-ui">
                  <StatusPill tone="at-risk" variant="dot" />
                  Disconnected
                </span>
                <span className="flex items-center gap-1.5 text-ui">
                  <StatusPill tone="neutral" variant="dot" dashed />
                  Not set up
                </span>
                <Badge variant="secondary">3</Badge>
                <Badge variant="role">Owner</Badge>
                <Kbd>⌘K</Kbd>
                <Stars value={4} />
                <Avatar>
                  <AvatarFallback>AS</AvatarFallback>
                </Avatar>
                <Avatar size="sm">
                  <AvatarFallback>PK</AvatarFallback>
                </Avatar>
                <code className="rounded-(--np-radius-tag) border border-line bg-surface-alt px-1.5 font-mono text-caption whitespace-nowrap">
                  PROVIDER_PERMISSION_DENIED
                </code>
              </Demo>
            </Specimen>
            <Specimen title="Alerts and banner">
              <div className="flex flex-col gap-3">
                <Alert variant="info">
                  <AlertTitle>Info</AlertTitle>
                  <AlertDescription>
                    Google revises the last few days of performance data.
                  </AlertDescription>
                </Alert>
                <Alert variant="success">
                  <AlertTitle>Live on Google</AlertTitle>
                  <AlertDescription>
                    Google confirmed the reply.
                  </AlertDescription>
                </Alert>
                <Alert variant="warning">
                  <AlertTitle>These figures may be incomplete</AlertTitle>
                  <AlertDescription>
                    Syncing is catching up with Google’s totals.
                  </AlertDescription>
                </Alert>
                <Alert variant="destructive">
                  <AlertTitle>Google declined this reply</AlertTitle>
                  <AlertDescription>
                    The connected login no longer manages this listing. Nothing
                    is live.{" "}
                    <code className="rounded-(--np-radius-tag) bg-surface px-1.5 font-mono text-caption">
                      PROVIDER_PERMISSION_DENIED
                    </code>
                  </AlertDescription>
                  <AlertActions>
                    <Button variant="secondary" size="sm">
                      Check the Google login
                    </Button>
                  </AlertActions>
                </Alert>
                <Alert>
                  <AlertTitle>A note with no status</AlertTitle>
                  <AlertDescription>
                    The sunken surface with a hairline.
                  </AlertDescription>
                </Alert>
                <Banner
                  tone="bad"
                  icon={<Unlink strokeWidth={1.75} aria-hidden />}
                  className="rounded-(--np-radius-card)"
                  action={
                    <Button variant="secondary" size="sm">
                      Reconnect
                    </Button>
                  }
                >
                  <strong>
                    The Old Crown’s Google login needs reconnecting.
                  </strong>{" "}
                  <span className="text-ink-secondary">
                    Page-wide banner under the toolbar.
                  </span>
                </Banner>
              </div>
            </Specimen>
          </div>

          <div id="ds-data" className="flex scroll-mt-4 flex-col gap-4">
            <Specimen
              title="Tables"
              note="Labelled rows below 720px of the table’s own width. Figures are mono and right-aligned."
            >
              <Table surface responsive>
                <caption className="sr-only">Locations, sample</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead numeric>Reviews</TableHead>
                    <TableHead numeric>Median reply</TableHead>
                    <TableHead className="w-px text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    [
                      "The Prince of Wales",
                      "LI-01",
                      "ok",
                      "On track",
                      "46",
                      "3 h 10 min",
                      false,
                    ],
                    [
                      "The Bell",
                      "LI-02 · selected row",
                      "warn",
                      "Slow replies",
                      "38",
                      "9 h",
                      true,
                    ],
                    [
                      "The Old Crown",
                      "OC-01",
                      "bad",
                      "Disconnected",
                      "18",
                      "—",
                      false,
                    ],
                  ].map(
                    ([name, code, tone, status, reviews, median, selected]) => (
                      <TableRow
                        key={String(name)}
                        data-selected={selected ? "true" : undefined}
                      >
                        <TableCell label="Location">
                          <div className="flex min-w-0 flex-col">
                            <span className="font-semibold">{name}</span>
                            <span className="text-caption text-ink-muted">
                              {code}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell label="Status">
                          <StatusPill tone={tone as "ok" | "warn" | "bad"}>
                            {status}
                          </StatusPill>
                        </TableCell>
                        <TableCell label="Reviews" numeric>
                          {reviews}
                        </TableCell>
                        <TableCell label="Median reply" numeric>
                          {median}
                        </TableCell>
                        <TableCell data-actions="" className="text-right">
                          <Button variant="ghost" size="sm">
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </Specimen>

            <Specimen
              title="Tabs"
              note="An ink underline; the row scrolls when it does not fit."
            >
              <Tabs defaultValue="reply">
                <TabsList aria-label="Tabs example">
                  <TabsTab value="reply">Reply performance</TabsTab>
                  <TabsTab value="google">Google performance</TabsTab>
                  <TabsTab value="keywords">Search keywords</TabsTab>
                </TabsList>
                <TabsPanel
                  value="reply"
                  className="text-caption text-ink-muted"
                >
                  First panel. Arrow keys move between tabs.
                </TabsPanel>
                <TabsPanel
                  value="google"
                  className="text-caption text-ink-muted"
                >
                  Second panel.
                </TabsPanel>
                <TabsPanel
                  value="keywords"
                  className="text-caption text-ink-muted"
                >
                  Third panel.
                </TabsPanel>
              </Tabs>
            </Specimen>

            <Specimen title="Stat tiles">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiTile
                  label="Reviews received"
                  value="211"
                  delta={{
                    value: "+4",
                    direction: "up",
                    label: "vs previous 28 days",
                  }}
                />
                <KpiTile
                  label="Median time to reply"
                  value="10 h 52 min"
                  delta={{
                    value: "+21 min",
                    direction: "up",
                    tone: "danger",
                    label: "slower",
                  }}
                />
                <KpiTile
                  label="Average rating"
                  value="4.4"
                  delta={{ value: "No change", direction: "flat" }}
                />
                <KpiTile
                  label="Response rate"
                  value="—"
                  hint="No comparison: missing is not zero"
                />
              </div>
            </Specimen>

            <Specimen title="Charts and progress" note="Sample figures.">
              <div className="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
                <figure className="m-0 flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-5">
                  <ChartLegend
                    items={[
                      { label: "Replied", colorVar: 2 },
                      { label: "Not yet replied", colorVar: 1 },
                    ]}
                  />
                  <div
                    aria-hidden
                    className="grid h-35 grid-cols-7 items-end gap-1.5"
                  >
                    {SAMPLE_REVIEWS.map((received, index) => (
                      <div
                        key={index}
                        className="flex h-full flex-col items-center justify-end gap-[3px]"
                      >
                        <span className="font-mono text-[11px] font-semibold tabular-nums">
                          {received}
                        </span>
                        <span
                          className={cn(
                            "w-full max-w-9 rounded-t-[3px] bg-chart-1",
                            BAR_H[received - SAMPLE_REPLIED[index]]
                          )}
                        />
                        <span
                          className={cn(
                            "w-full max-w-9 bg-chart-2",
                            BAR_H[SAMPLE_REPLIED[index]]
                          )}
                        />
                      </div>
                    ))}
                  </div>
                  <div
                    aria-hidden
                    className="flex justify-between font-mono text-[11px] text-ink-muted"
                  >
                    <span>16 Sep</span>
                    <span>22 Sep</span>
                  </div>
                  <figcaption className="text-caption text-ink-muted">
                    Filled marks, a legend, a direct label on every bar
                    (received), tabular numerals, and the same figures as a
                    table for assistive tech. Max {SAMPLE_MAX}.
                  </figcaption>
                  <ChartDataTable
                    caption="Reviews received and replied, sample"
                    columns={["Day", "Received", "Replied"]}
                    rows={SAMPLE_REVIEWS.map((received, index) => [
                      `${16 + index} Sep`,
                      received,
                      SAMPLE_REPLIED[index],
                    ])}
                  />
                </figure>
                <Demo column>
                  <Meter label="Response rate" value={83} />
                  <div className="flex flex-col gap-1">
                    <span className="text-ui">Import progress · 62%</span>
                    <Progress value={62} label="Import progress" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-ui">Failed import</span>
                    <Progress value={30} tone="bad" label="Failed import" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-ui">Queued, length unknown</span>
                    <Progress label="Queued import" />
                  </div>
                </Demo>
              </div>
            </Specimen>
          </div>

          <div id="ds-flow" className="flex scroll-mt-4 flex-col gap-4">
            <Specimen
              title="Progress through a task"
              note="Stepper for setup, lifecycle for a reply, timeline for activity."
            >
              <div className="grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
                <Demo column>
                  <Stepper
                    orientation="vertical"
                    aria-label="Setup steps"
                    steps={[
                      { id: "1", label: "Connect Google", state: "done" },
                      { id: "2", label: "Choose locations", state: "current" },
                      {
                        id: "3",
                        label: "Import review history",
                        state: "todo",
                        note: "Optional",
                      },
                      { id: "4", label: "Invite the team", state: "todo" },
                    ]}
                  />
                </Demo>
                <Demo column>
                  <Timeline
                    entries={[
                      {
                        id: "a",
                        title: "Review received from Google",
                        when: "2 h ago",
                        marker: <Inbox aria-hidden />,
                      },
                      {
                        id: "b",
                        title: "Verification passed",
                        when: "1 h ago",
                        tone: "success",
                      },
                      {
                        id: "c",
                        title: "Publish failed",
                        when: "40 min ago",
                        tone: "danger",
                        detail:
                          "PROVIDER_PERMISSION_DENIED · request 2c91-a0e4",
                      },
                    ]}
                  />
                </Demo>
              </div>
              <Demo column>
                <Stepper
                  aria-label="Setup steps, horizontal"
                  steps={[
                    { id: "h1", label: "Agency", state: "done" },
                    { id: "h2", label: "Client", state: "current" },
                    { id: "h3", label: "Connect", state: "todo" },
                  ]}
                />
                <Lifecycle
                  aria-label="Reply lifecycle"
                  stages={[
                    {
                      id: "r",
                      label: "Received",
                      state: "done",
                      meta: "From Google · 2 h ago",
                    },
                    {
                      id: "d",
                      label: "Drafted",
                      state: "done",
                      meta: "Tom B.",
                    },
                    {
                      id: "v",
                      label: "Verified",
                      state: "failed",
                      meta: "2 checks failed",
                    },
                    {
                      id: "a",
                      label: "Approved",
                      state: "current",
                      meta: "Awaiting approval",
                    },
                    {
                      id: "p",
                      label: "Published",
                      state: "todo",
                      meta: "Not on Google",
                    },
                  ]}
                />
                <p className="text-caption text-ink-muted">
                  Done, failed, current and to-do. A skipped step uses a dashed
                  ring. Under 520px of its own width the lifecycle turns
                  vertical.
                </p>
              </Demo>
            </Specimen>
            <Specimen
              title="Publish results"
              note="Each write states its own outcome. “Sent” is never shown as success."
            >
              <PublishSteps
                aria-label="Publish results, sample"
                live={false}
                steps={[
                  {
                    id: "1",
                    label: "Description",
                    state: "live",
                    detail: "Confirmed by verification",
                  },
                  {
                    id: "2",
                    label: "Sunday hours",
                    state: "sent",
                    detail: "Waiting for Google to confirm",
                  },
                  {
                    id: "3",
                    label: "Phone number",
                    state: "failed",
                    detail: "Google refused the change.",
                    errorCode: "PROVIDER_PERMISSION_DENIED",
                    action: (
                      <Button variant="secondary" size="sm">
                        Retry
                      </Button>
                    ),
                  },
                  {
                    id: "4",
                    label: "Attributes",
                    state: "skipped",
                    detail: "Unchanged",
                  },
                  { id: "5", label: "Menu", state: "pending" },
                ]}
              />
            </Specimen>
          </div>

          <div id="ds-states" className="flex scroll-mt-4 flex-col gap-4">
            <Specimen
              title="Empty, loading and error"
              note="Every region has all three. Errors name the cause, a safe code and the next step."
            >
              <div className="grid gap-4 md:grid-cols-3">
                <Card flush>
                  <Empty
                    tone="ok"
                    icon={<Check aria-hidden />}
                    title="Nothing needs a reply"
                    description="Every client’s reviews are handled."
                  />
                </Card>
                <Card aria-busy="true" className="gap-2.5">
                  <CardContent className="flex flex-col gap-2.5">
                    <p className="flex items-center gap-2 text-ui text-ink-muted">
                      <Spinner decorative size="sm" />
                      Loading reviews…
                    </p>
                    <Skeleton className="w-3/5" />
                    <Skeleton />
                    <Skeleton className="w-2/5" />
                  </CardContent>
                </Card>
                <Card flush>
                  <Empty
                    tone="bad"
                    icon={<CircleAlert aria-hidden />}
                    title="We couldn’t load this queue"
                    description="Nothing was changed. REQ 7f3a-19c2"
                    action={
                      <Button variant="secondary" size="sm">
                        Try again
                      </Button>
                    }
                  />
                </Card>
              </div>
            </Specimen>
          </div>

          <div id="ds-overlays" className="flex scroll-mt-4 flex-col gap-4">
            <Specimen
              title="Overlays and feedback"
              note="Dialogs confirm consequences; sheets hold longer forms; toasts report outcomes."
            >
              <Demo>
                <AlertDialog>
                  <AlertDialogTrigger render={<Button variant="secondary" />}>
                    Open a confirm dialog
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle>
                      Delete the published reply?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Google removes the reply from the listing. The review
                      stays and moves back to Needs reply.
                    </AlertDialogDescription>
                    <AlertDialogFooter>
                      <AlertDialogClose render={<Button variant="ghost" />}>
                        Keep the reply
                      </AlertDialogClose>
                      <AlertDialogClose render={<Button variant="danger" />}>
                        Delete from Google
                      </AlertDialogClose>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Dialog>
                  <DialogTrigger render={<Button variant="secondary" />}>
                    Open a dialog
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Rename this location</DialogTitle>
                      <DialogDescription>
                        The name inside NabaPresence only. Google keeps its own.
                      </DialogDescription>
                    </DialogHeader>
                    <Field>
                      <FieldLabel>Name</FieldLabel>
                      <Input defaultValue="The Bell" />
                    </Field>
                    <DialogFooter>
                      <DialogClose render={<Button variant="ghost" />}>
                        Cancel
                      </DialogClose>
                      <DialogClose render={<Button />}>Save</DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Sheet>
                  <SheetTrigger render={<Button variant="secondary" />}>
                    Open a sheet
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Sheet</SheetTitle>
                      <SheetDescription>
                        Slides from the right; from the bottom on phones.
                      </SheetDescription>
                    </SheetHeader>
                    <SheetBody>
                      <Field>
                        <FieldLabel>A longer form lives here</FieldLabel>
                        <Input />
                      </Field>
                    </SheetBody>
                    <SheetFooter>
                      <SheetClose render={<Button variant="ghost" />}>
                        Cancel
                      </SheetClose>
                      <SheetClose render={<Button />}>Save</SheetClose>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>

                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="secondary" />}>
                    Open a menu
                    <ChevronDown aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Review</DropdownMenuLabel>
                      <DropdownMenuItem>
                        <Pencil aria-hidden />
                        Assign to a colleague
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        Mark reviewed
                        <DropdownMenuShortcut>E</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem disabledReason="Only owners can export.">
                        Export history
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">
                      Delete published reply
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Popover>
                  <PopoverTrigger render={<Button variant="secondary" />}>
                    Open a popover
                  </PopoverTrigger>
                  <PopoverContent>
                    <PopoverTitle>Why is this flagged?</PopoverTitle>
                    <PopoverDescription>
                      The reply mentions a price that is not on the menu.
                    </PopoverDescription>
                  </PopoverContent>
                </Popover>

                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" />}>
                    Hover for a tooltip
                  </TooltipTrigger>
                  <TooltipContent>Charcoal, caption size</TooltipContent>
                </Tooltip>

                <CommandDemo
                  locations={["The Bell", "The Old Crown", "The Railway"]}
                />
              </Demo>
              <Demo>
                <span className="text-ui text-ink-muted">Toasts:</span>
                <ToastDemo />
              </Demo>
            </Specimen>
          </div>

          <div id="ds-forms" className="flex scroll-mt-4 flex-col gap-4">
            <Specimen
              title="Tag input"
              note="Enter or comma adds; Backspace in an empty field removes the last."
            >
              <Demo column>
                <TagInputDemo />
              </Demo>
            </Specimen>
            <Specimen
              title="Validation summary"
              note="Submit to see it: it takes focus and each problem links to its field."
            >
              <Demo column>
                <ValidationDemo />
              </Demo>
            </Specimen>
            <Specimen title="Card and section header">
              <Card>
                <CardHeader divided>
                  <CardTitle>Opening hours</CardTitle>
                  <CardDescription>
                    What Google shows on the listing.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <SectionHeader
                    as="h4"
                    title="Regular hours"
                    description="Seven days"
                    actions={
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    }
                  />
                  <p className="text-ui text-ink-muted">
                    Card head with a rule, body, and a sunken foot.
                  </p>
                </CardContent>
                <CardFooter bar>
                  <span className="text-caption text-ink-muted">
                    Saved here 4 min ago
                  </span>
                  <Button variant="secondary" size="sm">
                    Review changes
                  </Button>
                </CardFooter>
              </Card>
            </Specimen>
          </div>
        </Section>

        <Section
          title="Compositions"
          description="The customer’s words, the change diff and the action bar."
        >
          <figure className="m-0 flex flex-col gap-2.5 rounded-(--np-radius-card) bg-surface-alt p-4">
            <blockquote className="m-0 max-w-(--np-measure-reading) font-reading text-reading">
              Best curry night in the county. The staff remembered our order
              from last month.
            </blockquote>
            <figcaption className="font-mono text-caption text-ink-muted">
              Anita G. · 5 stars · sample review
            </figcaption>
          </figure>
          <DiffView
            caption="Changes to The Bell, sample"
            rows={[
              {
                field: "Description",
                before: "Village pub with rooms.",
                after: "Village pub serving Nepalese and British food.",
              },
              {
                field: "Sunday hours",
                before: "12:00–18:00 (sample)",
                after: "12:00–20:00 (sample)",
                state: "conflict",
              },
              {
                field: "Phone",
                before: "01223 277 217",
                after: "01223 277 217",
                state: "unchanged",
              },
            ]}
          />
          <ActionBar
            sticky={false}
            safeArea={false}
            label="Editor actions, sample"
            status={
              <>
                <Pencil aria-hidden />
                <span>
                  <strong>2 changes not on Google</strong>{" "}
                  <ActionBarMuted>· Saved here 4 min ago</ActionBarMuted>
                </span>
              </>
            }
            actions={
              <>
                <Button variant="ghost-dark">Discard</Button>
                <Button>Review changes</Button>
              </>
            }
          />
          <p className="text-caption text-ink-muted">
            The charcoal action bar is the one counter-surface per screen. It
            shows here beside the page’s own primary only because this is a
            gallery.
          </p>
        </Section>
      </main>
    </TooltipProvider>
  )
}
