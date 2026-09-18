import {
  Archive,
  Bell,
  Building2,
  Filter,
  Inbox,
  List,
  Map,
  MoreHorizontal,
  Plus,
  Reply,
  Search,
  Star,
  UserRound,
} from "lucide-react"

import { ContrastEvidence } from "@/app/design-system/contrast-evidence"
import { EditorFooterDemo } from "@/app/design-system/editor-footer-demo"
import { SpringDemo } from "@/app/design-system/spring-demo"
import { CommandDemo } from "@/app/design-system/command-demo"
import { ToastDemo } from "@/app/design-system/toast-demo"
import { CapabilityBanner } from "@/components/editors/capability-banner"
import { ChangeDiff } from "@/components/editors/change-diff"
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
import { Breadcrumbs } from "@/components/ui/breadcrumb"
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
import { ToggleChip } from "@/components/ui/chip"
import {
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty } from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { KpiTile } from "@/components/ui/kpi-tile"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { Textarea } from "@/components/ui/textarea"
import { Timeline } from "@/components/ui/timeline"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { STATUS_TONES } from "@/lib/ui/status-tone"
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

const SORT_ITEMS: Record<string, string> = {
  updated_desc: "Most recent",
  rating_desc: "Highest rated",
  rating_asc: "Lowest rated",
  replied: "Replied",
  unreplied: "Needs reply",
}

const DESIGN_SYSTEM_LOCATIONS = [
  "Riverside",
  "Old Crown",
  "The Plough",
] as const

const SURFACES = [
  ["canvas", "bg-canvas", "The page. Grouped background."],
  ["surface", "bg-surface", "Cards. No border, no shadow."],
  ["surface-raised", "bg-surface-raised", "A step up in the dark theme."],
  ["surface-sunken", "bg-surface-sunken", "Wells and inset regions."],
  ["surface-overlay", "bg-surface-overlay", "Dialogs and opaque popups."],
] as const

const LABELS = [
  ["ink", "text-ink", "Primary text. Measured at 4.5:1 everywhere."],
  ["ink-muted", "text-ink-muted", "Secondary text and captions. Also 4.5:1."],
  [
    "ink-faint",
    "text-ink-faint",
    "Decorative only: separators, inert glyphs. 3:1.",
  ],
  [
    "ink-quaternary",
    "text-ink-quaternary",
    "Disabled glyphs only. Never words.",
  ],
] as const

const FILLS = [
  ["fill", "bg-fill", "Grey buttons, segmented tracks"],
  ["fill-secondary", "bg-fill-secondary", "Search fields, keycaps, hover"],
  ["fill-tertiary", "bg-fill-tertiary", "Plain button hover, subtle wells"],
] as const

const LINES = [
  ["line-subtle", "border-line-subtle", "Row and card separators"],
  ["line", "border-line", "Popover arrow edge, shadcn --border"],
  ["line-strong", "border-line-strong", "Control edges. The only line at 3:1."],
] as const

const STATUS_FAMILIES = [
  {
    name: "success",
    tint: "bg-success-tint text-success-ink",
    solid: "bg-(--np-success-solid) text-(--np-success-on-solid)",
    line: "border-(--np-success-line)",
  },
  {
    name: "warning",
    tint: "bg-warning-tint text-warning-ink",
    solid: "bg-(--np-warning-solid) text-(--np-warning-on-solid)",
    line: "border-(--np-warning-line)",
  },
  {
    name: "danger",
    tint: "bg-danger-tint text-danger-ink",
    solid: "bg-(--np-danger-solid) text-(--np-danger-on-solid)",
    line: "border-(--np-danger-line)",
  },
  {
    name: "info",
    tint: "bg-info-tint text-info-ink",
    solid: "bg-(--np-info-solid) text-(--np-info-on-solid)",
    line: "border-(--np-info-line)",
  },
] as const

const TYPE_ROLES = [
  {
    role: "caption",
    className: "text-caption",
    spec: "12 / 16 · +0.01em",
    weight: "400, 500 for labels",
    use: "Metadata, footnotes, keycaps. 12px is the floor; 11px stays banned.",
  },
  {
    role: "ui",
    className: "text-ui",
    spec: "13 / 18",
    weight: "400, 500 for controls",
    use: "Buttons, menu items, table text, field labels.",
  },
  {
    role: "body",
    className: "text-body",
    spec: "14 / 20",
    weight: "400; 600 makes a headline",
    use: "Paragraphs, review text, descriptions.",
  },
  {
    role: "title",
    className: "text-title",
    spec: "15 / 20 · −0.01em",
    weight: "600",
    use: "Card titles, popover titles.",
  },
  {
    role: "section",
    className: "text-section",
    spec: "17 / 22 · −0.015em",
    weight: "600",
    use: "Dialog and sheet titles.",
  },
  {
    role: "page-title",
    className: "text-page-title",
    spec: "24 / 28 · −0.02em",
    weight: "700",
    use: "The one h1 on a page.",
  },
  {
    role: "display",
    className: "text-display",
    spec: "32 / 36 · −0.025em",
    weight: "700, tabular figures",
    use: "KPI figures.",
  },
] as const

const RADII = [
  ["tag", "6px", "Badges in cells, checkboxes, keycaps"],
  ["control", "10px", "Buttons, segmented tracks, menu rows' parent"],
  ["field", "10px", "Inputs and textareas"],
  ["card", "14px", "Cards, popovers, menus"],
  ["panel", "16px", "Auth card, inspector"],
  ["modal", "20px", "Dialogs"],
  ["sheet", "28px", "Bottom sheets"],
  ["pill", "999px", "Capsules and circles"],
] as const

const METRICS = [
  ["--np-gap-card", "12px", "Between cards in a grid"],
  ["--np-gap-section", "24px", "Between sections of a page"],
  ["--np-card-pad", "16px", "Inside a card; the grouped-list inset"],
  ["--np-panel-pad", "20px", "Inside a panel or inspector"],
  ["--np-page-pad-x / -y", "32px / 24px", "Page gutters; -x is 20px below md"],
  ["--np-toolbar-h", "52px", "The toolbar"],
  ["--np-sidebar-width", "244px", "The sidebar"],
] as const

const DENSITY = [
  ["--np-row-h", "44px", "32px", "List and table rows"],
  ["--np-control-h", "32px", "28px", "Buttons, selects, segmented controls"],
  ["--np-field-h", "34px", "30px", "Text fields"],
  ["--np-menu-item-h", "30px", "26px", "Menu rows"],
  ["--np-pill-h", "22px", "22px", "Badges and status pills"],
] as const

// Spelled out rather than templated so Tailwind sees every class.
const CHART_FILLS = [
  "bg-(--np-chart-1)",
  "bg-(--np-chart-2)",
  "bg-(--np-chart-3)",
  "bg-(--np-chart-4)",
  "bg-(--np-chart-5)",
  "bg-(--np-chart-6)",
] as const
const BUSY_TILES = [0, 1, 2, 3, 4, 5, 1, 3, 5, 0, 2, 4] as const

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
      className="flex flex-col gap-(--np-gap-section) border-t border-line-subtle pt-(--np-gap-section) first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className="flex flex-col gap-1">
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

/** One named specimen inside a section: an h3, an optional note, the thing. */
function Specimen({
  title,
  note,
  children,
}: {
  title: string
  note?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-title font-semibold text-ink">{title}</h3>
        {note ? (
          <p className="max-w-3xl text-ui text-ink-muted">{note}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function Swatch({
  name,
  className,
  note,
  edge = false,
}: {
  name: string
  className: string
  note: string
  edge?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "h-14 rounded-(--np-radius-control)",
          edge && "hairline",
          className
        )}
      />
      <p className="font-mono text-caption text-ink">{name}</p>
      <p className="text-caption text-ink-muted">{note}</p>
    </div>
  )
}

export const metadata = { title: "Design system · NabaPresence" }

export default function Page() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-svh w-full max-w-(--np-page-max-width) flex-col gap-(--np-gap-section) px-5 py-6 outline-none md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
    >
      <header className="flex flex-col gap-2">
        <p className="text-caption font-medium text-ink-muted">
          Apple-grade, platform-native, light-first
        </p>
        <h1 className="text-page-title font-bold text-balance text-ink">
          NabaPresence design system
        </h1>
        <p className="max-w-2xl text-ui text-ink-muted">
          The living reference. Every specimen reads the same tokens the app
          does, so a role that drifts shows up here first. Colour, type, shape
          and motion come from app/globals.css; the contrast pairs below are
          measured from that file, not asserted in a comment.
        </p>
        <p className="text-ui text-ink-muted">
          <a
            href="/design-system/inbox-prototype"
            className="text-accent-ink underline underline-offset-4"
          >
            Reviews inbox prototype
          </a>{" "}
          — the triage-and-reply workspace rebuilt on these tokens, on sample
          reviews.
        </p>
      </header>

      <Section
        title="Foundations"
        description="Colour is a small vocabulary: a grouped background, four inks, three greys, one accent and four status families. Everything else is a material, a hairline or a shadow."
      >
        <Specimen
          title="Surfaces"
          note="The page is a soft grey and content sits on white. A card needs neither a border nor a shadow to be a card; a white surface on another white surface takes the hairline."
        >
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {SURFACES.map(([name, className, note]) => (
              <Swatch
                key={name}
                name={name}
                className={className}
                note={note}
                edge
              />
            ))}
          </div>
        </Specimen>

        <Specimen
          title="Label ladder"
          note="Four inks. Words use the first two, both measured at 4.5:1 on every surface they land on. The last two are for ornament and disabled glyphs and may never carry text."
        >
          <div className="grid gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad) sm:grid-cols-2">
            {LABELS.map(([name, className, note]) => (
              <div key={name} className="flex flex-col gap-0.5">
                {name === "ink" || name === "ink-muted" ? (
                  <p className={cn("text-body font-medium", className)}>
                    Reply to Old Crown Girton
                  </p>
                ) : (
                  // Decorative inks never carry words, so the specimen is what
                  // they are for: a separator and an inert glyph.
                  <div
                    aria-hidden
                    className={cn("flex h-5 items-center gap-3", className)}
                  >
                    <span className="h-px w-24 bg-current" />
                    <span className="size-2 rounded-full bg-current" />
                    <span className="size-2 rounded-full bg-current" />
                  </div>
                )}
                <p className="font-mono text-caption text-ink-muted">{name}</p>
                <p className="text-caption text-ink-muted">{note}</p>
              </div>
            ))}
          </div>
        </Specimen>

        <div className="grid gap-(--np-gap-section) lg:grid-cols-2">
          <Specimen
            title="Fill ladder"
            note="The three greys controls are made of. A grey button is fill; the search field and keycaps are fill-secondary; a plain button hovers onto fill-tertiary."
          >
            <div className="flex flex-col gap-2 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
              {FILLS.map(([name, className, note]) => (
                <div
                  key={name}
                  className={cn(
                    "flex h-(--np-control-h) items-center justify-between rounded-(--np-radius-control) px-3",
                    className
                  )}
                >
                  <span className="font-mono text-caption text-ink">
                    {name}
                  </span>
                  <span className="text-caption text-ink-muted">{note}</span>
                </div>
              ))}
            </div>
          </Specimen>

          <Specimen
            title="Lines"
            note="Separators are thin and light. Only line-strong clears 3:1, which is why it is the edge of every field and outline button and nothing else."
          >
            <div className="flex flex-col rounded-(--np-radius-card) bg-surface px-(--np-card-pad) py-2">
              {LINES.map(([name, className, note]) => (
                <div
                  key={name}
                  className={cn(
                    "flex h-(--np-row-h) items-center justify-between border-t",
                    className
                  )}
                >
                  <span className="font-mono text-caption text-ink">
                    {name}
                  </span>
                  <span className="text-caption text-ink-muted">{note}</span>
                </div>
              ))}
            </div>
          </Specimen>
        </div>

        <Specimen
          title="Accent"
          note="System blue at hue 256, held to WCAG: the filled and text steps sit darker than the platform's so white and the tint both clear 4.5:1. The vivid step is for graphics only."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex h-14 items-center justify-center rounded-(--np-radius-control) bg-primary text-ui font-medium text-primary-foreground">
              Filled · bg-primary
            </div>
            <div className="flex h-14 items-center justify-center rounded-(--np-radius-control) bg-accent-tint text-ui font-medium text-accent-ink">
              Tinted · bg-accent-tint
            </div>
            <div className="flex h-14 items-center justify-center rounded-(--np-radius-control) bg-surface text-ui font-medium text-accent-ink">
              Link · text-accent-ink
            </div>
            <div className="flex h-14 items-center justify-center gap-2 rounded-(--np-radius-control) bg-surface text-ui text-ink-muted">
              <span className="size-4 rounded-(--np-radius-pill) bg-(--np-accent-vivid)" />
              Vivid · graphics at 3:1
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Status vocabulary"
          note="Four families, each with an ink, a tint, a solid and a line. Text is ink on tint; a filled indicator is on-solid on solid; the dot in a status pill is the solid. Five tones map onto them for everything that has a state."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STATUS_FAMILIES.map((family) => (
              <div
                key={family.name}
                className="flex flex-col gap-2 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)"
              >
                <p className="font-mono text-caption text-ink">{family.name}</p>
                <div
                  className={cn(
                    "flex h-(--np-control-h) items-center rounded-(--np-radius-control) px-3 text-ui font-medium",
                    family.tint
                  )}
                >
                  ink on tint
                </div>
                <div
                  className={cn(
                    "flex h-(--np-control-h) items-center rounded-(--np-radius-control) px-3 text-ui font-medium",
                    family.solid
                  )}
                >
                  on-solid on solid
                </div>
                <div
                  className={cn(
                    "flex h-(--np-control-h) items-center rounded-(--np-radius-control) border px-3 text-ui text-ink-muted",
                    family.line
                  )}
                >
                  line
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_TONES.map((tone) => (
                <StatusPill key={tone} tone={tone}>
                  {tone}
                </StatusPill>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {STATUS_TONES.map((tone) => (
                <StatusPill key={tone} tone={tone} variant="inline">
                  {tone}
                </StatusPill>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {STATUS_TONES.map((tone) => (
                <span
                  key={tone}
                  className="flex items-center gap-1.5 text-caption text-ink-muted"
                >
                  <StatusPill tone={tone} variant="dot" />
                  {tone}
                </span>
              ))}
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Materials"
          note="Sidebar, toolbar and popover are translucent and blurred, and content scrolls beneath them. Each has an opaque twin that takes over under prefers-reduced-transparency or when the browser cannot blur; text on a material is measured against the twin. A material never sits on a scrolling row."
        >
          <div className="relative h-72 overflow-hidden rounded-(--np-radius-card) bg-surface">
            <div
              aria-hidden
              className="absolute inset-0 grid grid-cols-4 gap-2 p-3 sm:grid-cols-6"
            >
              {BUSY_TILES.map((tile, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex items-end rounded-(--np-radius-control) p-2 text-caption font-semibold text-primary-foreground",
                    CHART_FILLS[tile]
                  )}
                ></div>
              ))}
            </div>

            <div className="absolute inset-y-0 left-0 hidden w-44 flex-col gap-1 material-sidebar p-3 [box-shadow:inset_-0.5px_0_0_var(--np-line)] sm:flex">
              <p className="px-2 pb-1 text-caption font-medium text-ink">
                material-sidebar
              </p>
              <span className="flex h-8 items-center gap-2 rounded-(--np-radius-control) bg-accent-tint px-2.5 text-ui font-medium text-accent-ink">
                <Inbox className="size-4" strokeWidth={1.75} aria-hidden />
                Inbox
              </span>
              <span className="flex h-8 items-center gap-2 rounded-(--np-radius-control) px-2.5 text-ui font-medium text-ink">
                <Building2 className="size-4" strokeWidth={1.75} aria-hidden />
                Clients
              </span>
              <span className="flex h-8 items-center gap-2 rounded-(--np-radius-control) px-2.5 text-ui font-medium text-ink">
                <Star className="size-4" strokeWidth={1.75} aria-hidden />
                Reporting
              </span>
            </div>

            <div className="absolute inset-x-0 top-0 flex h-(--np-toolbar-h) items-center justify-between material-toolbar px-4 [box-shadow:inset_0_-0.5px_0_var(--np-line)] sm:left-44">
              <span className="text-ui font-medium text-ink">
                material-toolbar
              </span>
              <span className="flex h-(--np-control-h) items-center gap-2 rounded-(--np-radius-pill) bg-fill-secondary px-3 text-ui text-ink-muted">
                <Search className="size-4" strokeWidth={1.75} aria-hidden />
                Search
                <Kbd>⌘K</Kbd>
              </span>
            </div>

            <div className="absolute right-4 bottom-4 w-52 rounded-(--np-radius-card) material-popover p-1 shadow-(--np-shadow-pop)">
              <p className="px-2 py-1.5 text-caption font-medium text-ink-muted">
                material-popover
              </p>
              <span className="flex h-(--np-menu-item-h) items-center rounded-(--np-radius-tag) bg-primary px-2 pl-7 text-ui text-primary-foreground">
                Reply
                <kbd className="ml-auto font-sans text-caption">⌘R</kbd>
              </span>
              <span className="flex h-(--np-menu-item-h) items-center rounded-(--np-radius-tag) px-2 pl-7 text-ui text-ink">
                Archive
              </span>
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Elevation"
          note="Cards on the canvas carry none. Chrome takes a hairline; overlays take a hairline plus an ambient and a key shadow. In the dark theme elevation is lightness first, shadow second."
        >
          <div className="grid gap-4 py-2 sm:grid-cols-2 lg:grid-cols-4">
            <Swatch
              name="hairline"
              className="bg-surface"
              note="0.5px edge. Toolbar, keycaps, outline buttons."
              edge
            />
            <Swatch
              name="shadow-raised"
              className="bg-surface shadow-(--np-shadow-raised)"
              note="Segmented thumb, switch knob."
            />
            <Swatch
              name="shadow-pop"
              className="bg-surface shadow-(--np-shadow-pop)"
              note="Menus, popovers, toasts."
            />
            <Swatch
              name="shadow-modal"
              className="bg-surface shadow-(--np-shadow-modal)"
              note="Dialogs and sheets."
            />
          </div>
        </Specimen>

        <Specimen
          title="Motion"
          note="A spring curve encoded as linear(), so every browser plays the same curve. Hover and press use the snappy spring over --np-duration-fast; overlays scale from their anchor on the full spring. Reduced motion collapses every duration globally."
        >
          <SpringDemo />
        </Specimen>

        <Specimen
          title="Contrast"
          note="Every ink/surface pair the product paints, measured in both themes from the shipping CSS by the same module the CI gate runs. Apple's own palette fails several of these; where the platform and WCAG disagree, WCAG wins."
        >
          <ContrastEvidence />
        </Specimen>
      </Section>

      <Section
        title="Typography"
        description="One family: San Francisco where the platform has it, Inter with its optical-size axis everywhere else. Seven roles, each owning a size, a line height and a tracking value. Hierarchy is weight and tracking, never a second typeface."
      >
        <Specimen title="Type roles">
          <div className="flex flex-col rounded-(--np-radius-card) bg-surface px-(--np-card-pad)">
            {TYPE_ROLES.map((role) => (
              <div
                key={role.role}
                className="grid gap-x-6 gap-y-1 border-t border-line-subtle py-4 first:border-t-0 md:grid-cols-[10rem_1fr_16rem] md:items-baseline"
              >
                <div className="flex flex-col">
                  <p className="font-mono text-caption text-ink">
                    text-{role.role}
                  </p>
                  <p className="text-caption text-ink-muted tabular-nums">
                    {role.spec}
                  </p>
                </div>
                <p
                  className={cn(
                    "text-ink",
                    role.className,
                    role.role === "display" && "font-bold tabular-nums",
                    role.role === "page-title" && "font-bold",
                    (role.role === "title" || role.role === "section") &&
                      "font-semibold"
                  )}
                >
                  {role.role === "display"
                    ? "4.6 · 128 · 92%"
                    : "Every client's Google reviews in one inbox"}
                </p>
                <div className="flex flex-col">
                  <p className="text-caption text-ink">Weight {role.weight}</p>
                  <p className="text-caption text-ink-muted">{role.use}</p>
                </div>
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen
          title="Weight carries hierarchy"
          note="A headline is body size at 600. A page title is 700. Figures are display at 700 with tabular numerals. The family never changes."
        >
          <div className="flex flex-col gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
            <p className="text-display font-bold text-ink tabular-nums">4.6</p>
            <p className="text-page-title font-bold text-ink">
              Old Crown Girton
            </p>
            <p className="text-section font-semibold text-ink">Edit hours</p>
            <p className="text-title font-semibold text-ink">
              Reply performance
            </p>
            <p className="text-body font-semibold text-ink">
              A headline is body at 600
            </p>
            <p className="text-body text-ink">
              Body text at 400 for review copy and descriptions.
            </p>
            <p className="text-ui font-medium text-ink">
              UI at 500 for controls and labels
            </p>
            <p className="text-caption text-ink-muted">
              Caption at 400, muted, for metadata · 12 min ago
            </p>
          </div>
        </Specimen>
      </Section>

      <Section
        title="Spacing and radius"
        description="Shape is a ladder of eight radii; nested corners are concentric by construction. Spacing is a handful of named metrics, and density changes only the ones that govern rows and controls."
      >
        <Specimen title="Radius ladder">
          <div className="grid gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {RADII.map(([name, value, note]) => (
              <div key={name} className="flex flex-col gap-1.5">
                <div
                  className="h-16 bg-surface hairline"
                  style={{ borderRadius: `var(--np-radius-${name})` }}
                />
                <p className="font-mono text-caption text-ink">
                  {name} · {value}
                </p>
                <p className="text-caption text-ink-muted">{note}</p>
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen
          title="Concentric corners"
          note="An inner radius is the outer radius minus the padding, written as rounded-[calc(var(--np-radius-panel)-6px)] or the next smaller token. Where the browser supports corner-shape, every corner is a superellipse."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <div className="rounded-(--np-radius-panel) bg-fill p-1.5">
                <div className="flex h-20 items-center justify-center rounded-[calc(var(--np-radius-panel)-6px)] bg-surface text-caption text-ink-muted tabular-nums">
                  16 − 6 = 10
                </div>
              </div>
              <p className="text-caption text-ink-muted">
                A panel radius with 6px of padding wraps a control radius.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="rounded-(--np-radius-card) bg-fill p-(--np-card-pad)">
                <div className="flex h-12 items-center justify-center rounded-(--np-radius-tag) bg-surface text-caption text-ink-muted tabular-nums">
                  14 − 16 &lt; 0 → tag
                </div>
              </div>
              <p className="text-caption text-ink-muted">
                When the padding exceeds the radius, pick the next smaller token
                rather than a negative value.
              </p>
            </div>
          </div>
        </Specimen>

        <div className="grid gap-(--np-gap-section) lg:grid-cols-2">
          <Specimen title="Spacing metrics">
            <div className="rounded-(--np-radius-card) bg-surface px-(--np-card-pad)">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Token</TableHead>
                    <TableHead numeric>Value</TableHead>
                    <TableHead>Where</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {METRICS.map(([token, value, where]) => (
                    <TableRow key={token}>
                      <TableCell className="font-mono text-caption">
                        {token}
                      </TableCell>
                      <TableCell numeric>{value}</TableCell>
                      <TableCell className="text-ink-muted">{where}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Specimen>

          <Specimen
            title="Density"
            note="data-density switches spacing only. Nothing drops below 12px text or a 24px target."
          >
            <div className="rounded-(--np-radius-card) bg-surface px-(--np-card-pad)">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Token</TableHead>
                    <TableHead numeric>Comfortable</TableHead>
                    <TableHead numeric>Compact</TableHead>
                    <TableHead>Governs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DENSITY.map(([token, comfortable, compact, governs]) => (
                    <TableRow key={token}>
                      <TableCell className="font-mono text-caption">
                        {token}
                      </TableCell>
                      <TableCell numeric>{comfortable}</TableCell>
                      <TableCell numeric>{compact}</TableCell>
                      <TableCell className="text-ink-muted">
                        {governs}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Specimen>
        </div>
      </Section>

      <Section
        title="Primitives"
        description="Every primitive in components/ui, in its rest state and the states that matter. Base UI underneath; triggers take render={…}."
      >
        <Specimen
          title="Button"
          note="Apple's four styles: filled, tinted, grey and plain, with outline as grey plus a hairline and destructive as a tinted red. Pill is the capsule for calls to action and toolbar circles. Every button presses to 0.98 on the snappy spring."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="default">Save changes</Button>
            <Button variant="tinted">Approve reply</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete reply</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button pill>New client</Button>
            <Button pill variant="tinted">
              <Plus strokeWidth={1.75} data-icon="inline-start" />
              Add location
            </Button>
            <Button pill variant="secondary">
              Grey pill
            </Button>
            <Button pill size="icon-sm" variant="secondary" aria-label="Filter">
              <Filter strokeWidth={1.75} />
            </Button>
            <Button
              pill
              size="icon"
              variant="secondary"
              aria-label="More actions"
            >
              <MoreHorizontal strokeWidth={1.75} />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon-xs" aria-label="Add item, extra small">
              <Plus strokeWidth={1.75} />
            </Button>
            <Button size="icon-sm" aria-label="Add item, small">
              <Plus strokeWidth={1.75} />
            </Button>
            <Button size="icon" aria-label="Add item">
              <Plus strokeWidth={1.75} />
            </Button>
            <Button size="icon-lg" aria-label="Add item, large">
              <Plus strokeWidth={1.75} />
            </Button>
            <Button disabled>Disabled</Button>
          </div>
        </Specimen>

        <Specimen
          title="Tooltip"
          note="For icon-only buttons. The aria-label is still the accessible name; the tooltip only repeats it for sighted people."
        >
          <TooltipProvider>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="Reply" />
                  }
                >
                  <Reply strokeWidth={1.75} />
                </TooltipTrigger>
                <TooltipContent>Reply</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="Archive" />
                  }
                >
                  <Archive strokeWidth={1.75} />
                </TooltipTrigger>
                <TooltipContent>Archive</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="More actions"
                    />
                  }
                >
                  <MoreHorizontal strokeWidth={1.75} />
                </TooltipTrigger>
                <TooltipContent side="bottom">More actions</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </Specimen>

        <div className="grid gap-(--np-gap-section) lg:grid-cols-2">
          <Specimen
            title="Badge"
            note="22px capsules; tag shape for badges that sit flush in cells and fields."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">Default</Badge>
              <Badge variant="tinted">Draft</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="ghost">Ghost</Badge>
              <Badge variant="link">Link</Badge>
              <Badge variant="success">Published</Badge>
              <Badge variant="warning">Stale</Badge>
              <Badge variant="destructive">Failed</Badge>
              <Badge variant="info">Syncing</Badge>
              <Badge variant="secondary" shape="tag">
                3
              </Badge>
              <Badge variant="tinted" shape="tag">
                Owner
              </Badge>
            </div>
          </Specimen>

          <Specimen
            title="Chip and keycap"
            note="A pressed filter chip is filled with the accent; keycaps are fill-secondary with a hairline, or plain in a menu's shortcut column."
          >
            <div className="flex flex-wrap items-center gap-2">
              <ToggleChip pressed>Needs reply</ToggleChip>
              <ToggleChip>5 stars</ToggleChip>
              <ToggleChip>Old Crown</ToggleChip>
              <ToggleChip disabled>Archived</ToggleChip>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Kbd>⌘K</Kbd>
              <Kbd>⌘⇧R</Kbd>
              <Kbd>Esc</Kbd>
              <span className="text-ui text-ink-muted">
                Plain: <Kbd variant="plain">⌘R</Kbd>
              </span>
            </div>
          </Specimen>
        </div>

        <Specimen
          title="Alert"
          note="Tint background, status ink, the variant's own glyph. role=alert for destructive and warning, role=status otherwise."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Alert variant="default">
              <AlertTitle>Default</AlertTitle>
              <AlertDescription>
                Neutral informational message.
              </AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>Publish failed</AlertTitle>
              <AlertDescription>
                Google rejected the reply. Check the connection and try again.
              </AlertDescription>
            </Alert>
            <Alert variant="success">
              <AlertTitle>Reply published</AlertTitle>
              <AlertDescription>It is live on Google.</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <AlertTitle>Data may be out of date</AlertTitle>
              <AlertDescription>Reconnect Google to refresh.</AlertDescription>
            </Alert>
            <Alert variant="info">
              <AlertTitle>Syncing</AlertTitle>
              <AlertDescription>
                New reviews arrive in the background.
              </AlertDescription>
            </Alert>
          </div>
        </Specimen>

        <div className="grid gap-(--np-gap-section) lg:grid-cols-2">
          <Specimen
            title="Card"
            note="White on the grey canvas, card radius, no border, no shadow. Inset divides its children with hairlines."
          >
            <Card>
              <CardHeader>
                <CardTitle as="h4">Reply performance</CardTitle>
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
                <Button size="sm" variant="secondary">
                  View report
                </Button>
              </CardFooter>
            </Card>
            <Card inset>
              <CardHeader>
                <CardTitle as="h4">Members</CardTitle>
              </CardHeader>
              {[
                ["Aman Shrestha", "Owner"],
                ["Sam Patel", "Editor"],
                ["Jo Lee", "Viewer"],
              ].map(([name, role]) => (
                <div
                  key={name}
                  className="flex min-h-(--np-row-h) items-center justify-between px-(--np-card-pad) py-2"
                >
                  <span className="text-body text-ink">{name}</span>
                  <span className="text-caption text-ink-muted">{role}</span>
                </div>
              ))}
            </Card>
          </Specimen>

          <Specimen
            title="Grouped list"
            note="Settings and profile: inset rows on a white group, separators indented from the leading edge, chevrons on navigational rows, a switch or a value trailing."
          >
            <GroupedList
              header="Notifications"
              footer="Applies to every location you manage."
            >
              <GroupedListItem
                icon={<Bell />}
                label="Email digest"
                description="Weekly, Monday 08:00"
                trailing={<Switch defaultChecked aria-label="Email digest" />}
              />
              <GroupedListItem
                icon={<Inbox />}
                label="New review alerts"
                trailing={<Switch aria-label="New review alerts" />}
              />
              <GroupedListItem
                icon={<UserRound />}
                label="Profile"
                trailing="Aman"
                href="/design-system#section-primitives"
              />
              <GroupedListItem label="Sign out" tone="danger" chevron={false} />
            </GroupedList>
          </Specimen>
        </div>

        <div className="grid gap-(--np-gap-section) lg:grid-cols-3">
          <Specimen
            title="Skeleton"
            note="In the shape of the content it stands for."
          >
            <div className="flex flex-col gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-(--np-radius-pill)" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </Specimen>

          <Specimen
            title="Spinner"
            note="Only beside a sentence that says what is loading."
          >
            <div className="flex items-center gap-4 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
              <Spinner decorative size="sm" />
              <Spinner label="Loading reviews" />
              <Spinner decorative size="lg" />
              <span className="flex items-center gap-2 text-ui text-ink-muted">
                <Spinner decorative size="sm" />
                Loading reviews
              </span>
            </div>
          </Specimen>

          <Specimen title="Avatar" note="Circles with a hairline edge.">
            <div className="flex items-center gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
              <Avatar size="sm">
                <AvatarFallback>AS</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>SP</AvatarFallback>
              </Avatar>
              <Avatar size="lg">
                <AvatarFallback>JL</AvatarFallback>
              </Avatar>
            </div>
          </Specimen>
        </div>

        <div className="grid gap-(--np-gap-section) lg:grid-cols-2">
          <Specimen
            title="Field and input"
            note="Label above, control at field height, a half-pixel line-strong edge that becomes the halo plus the edge on focus. The search variant is a capsule on fill-secondary with a clear button."
          >
            <div className="flex flex-col gap-4 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
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
              <Field>
                <FieldLabel>Phone</FieldLabel>
                <Input defaultValue="01223 277 217" disabled />
              </Field>
              <Input
                type="search"
                aria-label="Search reviews"
                placeholder="Search reviews"
                defaultValue="Girton"
              />
              <Textarea
                aria-label="Reply draft"
                defaultValue="Thank you for the kind words — we're glad you enjoyed your stay."
              />
            </div>
          </Specimen>

          <Specimen
            title="Choice controls"
            note="Switch for on/off settings, checkbox for selection in a list or form, radio for one of a few. The switch track turns the vivid accent; the checkbox and radio spring their indicator in."
          >
            <div className="flex flex-col gap-5 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
              <div className="flex flex-col gap-3">
                <label className="flex items-center justify-between text-ui text-ink">
                  Email alerts
                  <Switch defaultChecked />
                </label>
                <label className="flex items-center justify-between text-ui text-ink">
                  Publish without review
                  <Switch />
                </label>
                <label className="flex items-center justify-between text-ui text-ink">
                  Large switch for touch
                  <Switch size="lg" defaultChecked />
                </label>
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-ui text-ink">
                  <Checkbox defaultChecked />
                  Include Riverside
                </label>
                <label className="flex items-center gap-2 text-ui text-ink">
                  <Checkbox />
                  Include Old Crown
                </label>
                <label className="flex items-center gap-2 text-ui text-ink">
                  <Checkbox indeterminate />
                  Some locations
                </label>
              </div>
              <RadioGroup aria-label="Reply channel" defaultValue="email">
                <RadioGroupItem value="email">Email</RadioGroupItem>
                <RadioGroupItem value="sms">Text message</RadioGroupItem>
                <RadioGroupItem value="none" disabled>
                  Do not notify
                </RadioGroupItem>
              </RadioGroup>
            </div>
          </Specimen>
        </div>

        <Specimen
          title="Segmented control"
          note="For switching views of the same data. A grey track, a white raised thumb that slides on the snappy spring; the selected segment is the tab stop and arrows move the selection."
        >
          <div className="flex flex-wrap items-center gap-4">
            <SegmentedControl aria-label="View" defaultValue="list">
              <SegmentedControlItem value="list">
                <List strokeWidth={1.75} />
                List
              </SegmentedControlItem>
              <SegmentedControlItem value="map">
                <Map strokeWidth={1.75} />
                Map
              </SegmentedControlItem>
            </SegmentedControl>
            <SegmentedControl
              aria-label="Queue"
              defaultValue="needs_reply"
              size="sm"
            >
              <SegmentedControlItem value="all">All</SegmentedControlItem>
              <SegmentedControlItem value="needs_reply">
                Needs reply
              </SegmentedControlItem>
              <SegmentedControlItem value="published">
                Published
              </SegmentedControlItem>
            </SegmentedControl>
          </div>
        </Specimen>

        <Specimen
          title="Tabs"
          note="For genuinely separate sections of a page. Labels over a hairline with an accent underline that slides."
        >
          <Tabs defaultValue="reviews">
            <TabsList>
              <TabsTab value="reviews">Reviews</TabsTab>
              <TabsTab value="profile">Profile</TabsTab>
              <TabsTab value="access">Access</TabsTab>
            </TabsList>
            <TabsPanel value="reviews" className="pt-3 text-body text-ink">
              Every review across connected locations.
            </TabsPanel>
            <TabsPanel value="profile" className="pt-3 text-body text-ink">
              The Google Business Profile fields.
            </TabsPanel>
            <TabsPanel value="access" className="pt-3 text-body text-ink">
              Who can see and publish for this client.
            </TabsPanel>
          </Tabs>
        </Specimen>

        <div className="grid gap-(--np-gap-section) lg:grid-cols-3">
          <Specimen
            title="Select"
            note="A grey control; the popup is the popover material with a checkmark column."
          >
            <Select defaultValue="updated_desc" items={SORT_ITEMS}>
              <SelectTrigger aria-label="Sort reviews" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectGroupLabel>Order</SelectGroupLabel>
                  <SelectItem value="updated_desc">Most recent</SelectItem>
                  <SelectItem value="rating_desc">Highest rated</SelectItem>
                  <SelectItem value="rating_asc">Lowest rated</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="unreplied">Needs reply</SelectItem>
              </SelectContent>
            </Select>
          </Specimen>

          <Specimen
            title="Combobox"
            note="A field that filters a list. Items stay plain data so the page can remain a server component."
          >
            <Combobox items={DESIGN_SYSTEM_LOCATIONS}>
              <ComboboxInput
                placeholder="All locations"
                aria-label="Filter by location"
              />
              <ComboboxContent>
                <ComboboxGroup>
                  <ComboboxGroupLabel>Locations</ComboboxGroupLabel>
                  {DESIGN_SYSTEM_LOCATIONS.map((location) => (
                    <ComboboxItem key={location} value={location}>
                      {location}
                    </ComboboxItem>
                  ))}
                </ComboboxGroup>
              </ComboboxContent>
            </Combobox>
          </Specimen>

          <Specimen
            title="Dropdown menu"
            note="30px rows, a checkmark column, a shortcut column, the solid accent highlight."
          >
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="secondary" />}>
                Review actions
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>
                  <Reply />
                  Reply
                  <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Archive />
                  Archive
                  <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem>Needs reply</DropdownMenuItem>
                    <DropdownMenuItem>Published</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Show</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem defaultChecked>
                    Resolved reviews
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuRadioGroup defaultValue="newest">
                    <DropdownMenuRadioItem value="newest">
                      Newest first
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="oldest">
                      Oldest first
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  Delete published reply
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Specimen>
        </div>

        <Specimen
          title="Command"
          note="A capsule search field, grouped rows, a trailing keycap, on the popover material. Opens with ⌘K in the app."
        >
          <CommandDemo locations={DESIGN_SYSTEM_LOCATIONS} />
        </Specimen>

        <div className="grid gap-(--np-gap-section) sm:grid-cols-2 lg:grid-cols-4">
          <Specimen
            title="Dialog"
            note="Scales from 0.96 on the spring. Cancel then the primary, last."
          >
            <Dialog>
              <DialogTrigger render={<Button variant="secondary" />}>
                Edit hours
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit hours</DialogTitle>
                  <DialogDescription>
                    Weekly schedule for Old Crown Girton.
                  </DialogDescription>
                </DialogHeader>
                <Field>
                  <FieldLabel>Monday</FieldLabel>
                  <Input defaultValue="11:00 – 23:00" />
                </Field>
                <DialogFooter>
                  <DialogClose render={<Button variant="secondary" />}>
                    Cancel
                  </DialogClose>
                  <Button>Save changes</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Specimen>

          <Specimen
            title="Alert dialog"
            note="Names the object it destroys. Buttons stack on small screens."
          >
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="destructive" />}>
                Discard edits
              </AlertDialogTrigger>
              <AlertDialogContent aria-label="Discard your edits to Old Crown Girton?">
                <AlertDialogTitle>
                  Discard your edits to Old Crown Girton?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Regenerating replaces your unsaved changes with a new draft.
                  This cannot be undone.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="secondary" />}>
                    Keep editing
                  </AlertDialogClose>
                  <Button variant="destructive">Discard and regenerate</Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Specimen>

          <Specimen
            title="Sheet"
            note="A side panel from md; a bottom sheet with a grabber below it."
          >
            <Sheet>
              <SheetTrigger render={<Button variant="secondary" />}>
                Open inspector
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>Review detail</SheetTitle>
                  <SheetDescription>
                    The full review, the draft and its history.
                  </SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
          </Specimen>

          <Specimen
            title="Popover"
            note="Lightweight detail with an arrow, grown from its anchor."
          >
            <Popover>
              <PopoverTrigger render={<Button variant="secondary" />}>
                Filters
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start">
                <PopoverTitle render={<h4 />}>Filters</PopoverTitle>
                <PopoverDescription>Narrow the queue.</PopoverDescription>
                <div className="mt-3 flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-ui text-ink">
                    <Checkbox defaultChecked />
                    Needs reply
                  </label>
                  <label className="flex items-center gap-2 text-ui text-ink">
                    <Checkbox />
                    Low rating
                  </label>
                </div>
                <div className="mt-4 flex justify-end">
                  <PopoverClose render={<Button size="sm" />}>
                    Apply filters
                  </PopoverClose>
                </div>
              </PopoverContent>
            </Popover>
          </Specimen>
        </div>

        <Specimen
          title="Toast"
          note="Bottom-centre on a phone, top-right from sm; stacked on the popover material."
        >
          <ToastDemo />
        </Specimen>

        <Specimen
          title="Table"
          note="No zebra. Hairline separators, a muted header with no uppercase and no background, hover on the hover token, the selected row on the accent tint, figures tabular and right-aligned."
        >
          <div className="rounded-(--np-radius-card) bg-surface px-(--np-card-pad)">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead numeric>Reviews</TableHead>
                  <TableHead numeric>Rating</TableHead>
                  <TableHead numeric>Reply rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Old Crown Girton</TableCell>
                  <TableCell>
                    <StatusPill tone="healthy" variant="inline">
                      Healthy
                    </StatusPill>
                  </TableCell>
                  <TableCell numeric>128</TableCell>
                  <TableCell numeric>4.6</TableCell>
                  <TableCell numeric>92%</TableCell>
                </TableRow>
                <TableRow data-selected="true">
                  <TableCell>Riverside</TableCell>
                  <TableCell>
                    <StatusPill tone="attention" variant="inline">
                      Needs attention
                    </StatusPill>
                  </TableCell>
                  <TableCell numeric>41</TableCell>
                  <TableCell numeric>4.1</TableCell>
                  <TableCell numeric>67%</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>The Plough</TableCell>
                  <TableCell>
                    <StatusPill tone="pending" variant="inline">
                      Syncing
                    </StatusPill>
                  </TableCell>
                  <TableCell numeric>9</TableCell>
                  <TableCell numeric>4.8</TableCell>
                  <TableCell numeric>100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Specimen>

        <Specimen
          title="Empty"
          note="A light glyph, a title, one sentence, one action."
        >
          <div className="rounded-(--np-radius-card) bg-surface">
            <Empty
              icon={<Inbox />}
              title="No reviews yet"
              description="New Google reviews will appear here as they arrive."
              action={<Button pill>Connect Google</Button>}
            />
          </div>
        </Specimen>
      </Section>

      <Section
        title="Compositions"
        description="The pieces built for the agency product. Each one exists because the same shape was being reinvented per screen."
      >
        <Specimen
          title="KPI tile"
          note="Label above, a display figure in tabular numerals, the movement spoken as well as drawn."
        >
          <div className="grid gap-(--np-gap-card) sm:grid-cols-3">
            <KpiTile
              label="Reviews received"
              value="128"
              hint="Last 30 days"
              delta={{
                value: "+12",
                direction: "up",
                label: "vs previous 30 days",
              }}
            />
            <KpiTile
              label="Average rating"
              value="4.6"
              hint="Last 30 days"
              delta={{
                value: "0.0",
                direction: "flat",
                label: "vs previous 30 days",
              }}
            />
            <KpiTile
              label="Needs reply"
              value="12"
              hint="Right now"
              delta={{
                value: "+4",
                direction: "up",
                tone: "danger",
                label: "vs last week",
              }}
            />
          </div>
        </Specimen>

        <div className="grid gap-(--np-gap-section) lg:grid-cols-2">
          <Specimen
            title="Timeline"
            note="An ordered list; the dot colour is never the only signal."
          >
            <div className="rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
              <Timeline
                entries={[
                  {
                    id: "1",
                    title: "Reply published",
                    meta: "Aman · 12 min ago",
                    tone: "success",
                  },
                  {
                    id: "2",
                    title: "Draft approved",
                    meta: "Sam · 25 min ago",
                    tone: "accent",
                  },
                  {
                    id: "3",
                    title: "Google flagged the phone number",
                    meta: "System · Yesterday",
                    tone: "warning",
                    detail:
                      "The number on Google changed after this draft started.",
                  },
                  {
                    id: "4",
                    title: "Review received",
                    meta: "Google · 2 days ago",
                    tone: "neutral",
                  },
                ]}
              />
            </div>
          </Specimen>

          <Specimen
            title="Stepper"
            note="Done is tinted with a check; current is filled; to do is grey."
          >
            <div className="flex flex-col gap-6 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
              <Stepper
                steps={[
                  { id: "agency", label: "Agency", state: "done" },
                  { id: "client", label: "Client", state: "done" },
                  { id: "connect", label: "Connect Google", state: "current" },
                  { id: "locations", label: "Locations", state: "todo" },
                ]}
              />
              <Stepper
                orientation="vertical"
                steps={[
                  { id: "draft", label: "Draft", state: "done" },
                  { id: "review", label: "Review", state: "current" },
                  { id: "publish", label: "Publish", state: "todo" },
                ]}
              />
            </div>
          </Specimen>
        </div>

        <Specimen
          title="Change diff"
          note="What every Google write shows before it happens. A conflict row says Google moved the field after the draft started."
        >
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
        </Specimen>

        <Specimen
          title="Editor footer"
          note="One primary action. The gate note carries the reason whenever it is disabled."
        >
          <EditorFooterDemo />
        </Specimen>

        <Specimen title="Capability banner">
          <CapabilityBanner
            tone="read_only"
            title="You can look, but not change this"
            description="Only owners and admins can edit this location."
          />
        </Specimen>

        <Specimen title="Breadcrumb">
          <Breadcrumbs
            crumbs={[
              { label: "Clients", href: "/clients" },
              { label: "Old Crown Group", href: "/clients/demo" },
              { label: "Old Crown Girton" },
            ]}
          />
        </Specimen>
      </Section>
    </main>
  )
}
