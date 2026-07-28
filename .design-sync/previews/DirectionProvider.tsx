// DirectionProvider renders NO DOM of its own — it only publishes a React
// context that Base UI parts read (`useDirection`). Per Base UI's own docs it
// "does not affect HTML and CSS: the `dir="rtl"` HTML attribute … must be set
// additionally by your own application code". So every cell below pairs
// `<DirectionProvider direction>` with `dir` on the same wrapper, which is the
// only combination that actually mirrors a layout, and shows LTR beside RTL so
// the mirroring is visible rather than implied.
import {
  Avatar,
  AvatarFallback,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  DirectionProvider,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Slider,
} from "NabaReview"
import type { ReactNode } from "react"
import { ChevronLeft, Star } from "lucide-react"

type Dir = "ltr" | "rtl"

/** One labelled pane. `dir` on the element, `direction` on the provider. */
function Pane({
  direction,
  caption,
  children,
}: {
  direction: Dir
  caption: string
  children: ReactNode
}) {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono">
          {direction}
        </Badge>
        <span className="text-xs text-muted-foreground">{caption}</span>
      </div>
      <div
        dir={direction}
        className="rounded-2xl border border-border bg-muted/30 p-4"
      >
        <DirectionProvider direction={direction}>{children}</DirectionProvider>
      </div>
    </div>
  )
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>
}

/* ── 1. A review row: media, content and actions all swap sides ─────────── */

function ReviewRow({ direction }: { direction: Dir }) {
  return (
    <Item variant="outline" className="bg-background">
      <ItemMedia>
        <Avatar>
          <AvatarFallback>PS</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          Priya Sharma
          <span className="font-mono text-xs text-muted-foreground">
            Central
          </span>
        </ItemTitle>
        {/* item.tsx hard-codes `text-left` on ItemDescription (should be
            `text-start`), so RTL needs this override to follow the flip. */}
        {/* No trailing full stop: a neutral character at the end of a Latin
            run inside an RTL paragraph is reordered to the far edge by the
            bidi algorithm, and reads as a rendering fault. */}
        <ItemDescription
          className={direction === "rtl" ? "text-right" : "text-left"}
        >
          Front desk could not have been kinder
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="ghost">
          Draft
        </Button>
        <Button size="sm">Reply</Button>
      </ItemActions>
    </Item>
  )
}

export function MirroredReviewRow() {
  return (
    <Stack>
      <Pane direction="ltr" caption="avatar leads, actions trail">
        <ReviewRow direction="ltr" />
      </Pane>
      <Pane direction="rtl" caption="avatar and actions swap ends">
        <ReviewRow direction="rtl" />
      </Pane>
    </Stack>
  )
}

/* ── 2. A filter form: label, input text and button row all mirror ──────── */

function FilterForm({ direction }: { direction: Dir }) {
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor={`q-${direction}`}>Search reviews</FieldLabel>
        <Input id={`q-${direction}`} placeholder="Guest name or review text" />
        {/* field.tsx hard-codes `text-left` on FieldDescription too. */}
        <FieldDescription
          className={direction === "rtl" ? "text-right" : "text-left"}
        >
          Searches all 1,284 reviews synced from Google Business Profile
        </FieldDescription>
      </Field>
      {/* Deliberately loose Buttons rather than a horizontal ButtonGroup:
          button-group.tsx joins segments with PHYSICAL rounded-l/rounded-r
          and border-l-0, none of which follow `dir`, so an RTL group loses
          its outer border and rounds the wrong ends. */}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm">
          All
        </Button>
        <Button variant="outline" size="sm">
          Awaiting
        </Button>
        <Button variant="outline" size="sm">
          Escalated
        </Button>
      </div>
    </div>
  )
}

export function MirroredFilterForm() {
  return (
    <Stack>
      <Pane direction="ltr" caption="label, placeholder and group read left to right">
        <FilterForm direction="ltr" />
      </Pane>
      <Pane direction="rtl" caption="same markup, mirrored inline axis">
        <FilterForm direction="rtl" />
      </Pane>
    </Stack>
  )
}

/* ── 3. A breadcrumb trail: crumb order reverses ────────────────────────── */

function Trail({ direction }: { direction: Dir }) {
  const Sep =
    direction === "rtl" ? (
      // The default separator is a right chevron, which does not mirror on
      // its own — an RTL app has to supply the flipped glyph.
      <BreadcrumbSeparator>
        <ChevronLeft />
      </BreadcrumbSeparator>
    ) : (
      <BreadcrumbSeparator />
    )
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#" />}>Reviews</BreadcrumbLink>
        </BreadcrumbItem>
        {Sep}
        <BreadcrumbItem>
          <BreadcrumbLink render={<a href="#" />}>Central</BreadcrumbLink>
        </BreadcrumbItem>
        {Sep}
        <BreadcrumbItem>
          <BreadcrumbPage>Awaiting reply</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export function MirroredBreadcrumb() {
  return (
    <Stack>
      <Pane direction="ltr" caption="Reviews → Central → Awaiting reply">
        <Trail direction="ltr" />
      </Pane>
      <Pane direction="rtl" caption="same trail, right-anchored and reversed">
        <Trail direction="rtl" />
      </Pane>
    </Stack>
  )
}

/* ── 4. A slider: the case Base UI documents for this provider ──────────── */

function RatingFilter({ direction }: { direction: Dir }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">Minimum rating</span>
        <span className="inline-flex items-center gap-1 font-mono text-sm text-muted-foreground">
          <Star className="size-3 fill-rating text-rating" />
          4.0
        </span>
      </div>
      {/* Pass an array even for a single thumb — a scalar defaultValue falls
          through to [min, max] and renders two thumbs. */}
      <Slider defaultValue={[4]} min={1} max={5} step={1} />
      <span className="text-xs text-muted-foreground">
        {direction === "rtl"
          ? "Track fills from the right — drag and arrow keys invert too"
          : "Track fills from the left"}
      </span>
    </div>
  )
}

export function MirroredRatingSlider() {
  return (
    <Stack>
      <Pane direction="ltr" caption="indicator grows from the inline start">
        <RatingFilter direction="ltr" />
      </Pane>
      <Pane direction="rtl" caption="inline start is now the right edge">
        <RatingFilter direction="rtl" />
      </Pane>
    </Stack>
  )
}
