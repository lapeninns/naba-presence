import {
  Badge,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "NabaReview"
import { Camera, ImageIcon, Star } from "lucide-react"

// CarouselPrevious / CarouselNext are absolutely positioned at -left-12 /
// -right-12 of the Carousel root, so the root needs a 3rem horizontal margin or
// both arrows land outside the card. CarouselItem defaults to basis-full;
// flex-basis is set inline for the multi-per-view variants because the
// `basis-1/2` / `basis-1/3` utilities are not in the compiled bundle sheet.

const PHOTOS = [
  { id: "central-lobby", location: "Central", caption: "Lobby, after the 2024 refit", date: "12 Apr" },
  { id: "central-room", location: "Central", caption: "Corner double, floor 4", date: "12 Apr" },
  { id: "riverside-terrace", location: "Riverside", caption: "Terrace at breakfast", date: "28 Mar" },
  { id: "airport-desk", location: "Airport", caption: "24-hour front desk", date: "02 Mar" },
]

export function LocationPhotos() {
  return (
    <Carousel className="mx-12 max-w-md">
      <CarouselContent>
        {PHOTOS.map((p) => (
          <CarouselItem key={p.id}>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex aspect-video items-center justify-center bg-muted">
                <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
              </div>
              <div className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {p.caption}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {p.date} &middot; Google Business Profile
                  </span>
                </div>
                <Badge variant="secondary">{p.location}</Badge>
              </div>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}

const HIGHLIGHTS = [
  {
    name: "Priya Sharma",
    location: "Riverside",
    rating: 5,
    quote: "Late check-in was handled without a fuss and the room matched the photos.",
  },
  {
    name: "Tom Okafor",
    location: "Central",
    rating: 4,
    quote: "Quiet floor, quick breakfast, and the desk held my bags all afternoon.",
  },
  {
    name: "Marco Silva",
    location: "Airport",
    rating: 5,
    quote: "Shuttle every 20 minutes at 05:00 — that alone is worth the booking.",
  },
  {
    name: "Lena Fischer",
    location: "Central",
    rating: 4,
    quote: "Second stay this quarter. The lift repair was clearly taken seriously.",
  },
]

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={
            i <= value ? "size-3.5 fill-rating text-rating" : "size-3.5 text-muted-foreground/40"
          }
        />
      ))}
    </span>
  )
}

export function ReviewHighlights() {
  return (
    <Carousel className="mx-12 max-w-lg">
      <CarouselContent>
        {HIGHLIGHTS.map((r) => (
          <CarouselItem key={r.name} style={{ flexBasis: "50%" }}>
            <div className="flex h-full flex-col gap-2 rounded-2xl border border-border bg-card p-4">
              <Stars value={r.rating} />
              <p className="text-sm text-foreground">&ldquo;{r.quote}&rdquo;</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <span className="truncate text-xs font-medium text-foreground">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.location}</span>
              </div>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}

const STRIP = [
  { id: "s1", location: "Central", label: "Lobby" },
  { id: "s2", location: "Central", label: "Bar" },
  { id: "s3", location: "Riverside", label: "Terrace" },
  { id: "s4", location: "Riverside", label: "Suite" },
  { id: "s5", location: "Airport", label: "Desk" },
  { id: "s6", location: "Airport", label: "Shuttle" },
]

export function ThumbnailStrip() {
  return (
    <Carousel className="mx-12 max-w-lg">
      <CarouselContent>
        {STRIP.map((s) => (
          <CarouselItem key={s.id} style={{ flexBasis: "33.3333%" }}>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex aspect-square items-center justify-center bg-muted">
                <Camera className="size-6 text-muted-foreground" aria-hidden />
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-2">
                <span className="truncate text-xs font-medium text-foreground">{s.label}</span>
                <span className="truncate text-[11px] text-muted-foreground">{s.location}</span>
              </div>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}
