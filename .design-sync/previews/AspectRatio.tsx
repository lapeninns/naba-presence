import { AspectRatio, Badge } from "NabaReview"
import { ImageIcon, MapPin, Star } from "lucide-react"

/** Offline-safe stand-in for a Google Business Profile photo. */
function PhotoBlock({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-muted">
      <ImageIcon className="size-6 text-muted-foreground" />
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

/** Static-map stand-in: streets drawn with currentColor so it follows the theme. */
function MapBlock() {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-xl bg-muted">
      <svg
        viewBox="0 0 160 160"
        className="size-full text-muted-foreground"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.35}
        strokeWidth={2}
      >
        <path d="M0 46h160M0 104h160M42 0v160M112 0v160" />
        <path d="M0 130 60 96l40 22 60-38" strokeOpacity={0.2} strokeWidth={6} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <MapPin className="size-6 text-primary" />
      </div>
    </div>
  )
}

export function Ratios() {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex w-56 flex-col gap-2">
        <AspectRatio ratio={16 / 9}>
          <PhotoBlock label="16 / 9" />
        </AspectRatio>
        <span className="font-mono text-xs text-muted-foreground">ratio={"{16 / 9}"}</span>
      </div>
      <div className="flex w-56 flex-col gap-2">
        <AspectRatio ratio={4 / 3}>
          <PhotoBlock label="4 / 3" />
        </AspectRatio>
        <span className="font-mono text-xs text-muted-foreground">ratio={"{4 / 3}"}</span>
      </div>
      <div className="flex w-56 flex-col gap-2">
        <AspectRatio ratio={1}>
          <PhotoBlock label="1 / 1" />
        </AspectRatio>
        <span className="font-mono text-xs text-muted-foreground">ratio={"{1}"}</span>
      </div>
    </div>
  )
}

export function LocationPhoto() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <AspectRatio ratio={16 / 9} className="overflow-hidden rounded-xl border border-border">
        <PhotoBlock label="lapen-central-lobby.jpg" />
        <Badge variant="secondary" className="absolute top-4 right-4 z-10">
          Central
        </Badge>
      </AspectRatio>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">Lapen Inn — Central</span>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Star aria-hidden className="size-4 fill-rating text-rating" />
          <span className="font-mono tabular-nums">4.7</span>
        </span>
      </div>
    </div>
  )
}

export function MapTile() {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex w-56 flex-col gap-2">
        <AspectRatio ratio={1} className="overflow-hidden rounded-xl border border-border">
          <MapBlock />
        </AspectRatio>
        <span className="text-xs text-muted-foreground">
          Riverside · 12 Wharf Road
        </span>
      </div>
      <div className="flex w-56 flex-col gap-2">
        <AspectRatio ratio={4 / 3} className="overflow-hidden rounded-xl border border-border">
          <MapBlock />
        </AspectRatio>
        <span className="text-xs text-muted-foreground">
          Airport · Terminal 2 Approach
        </span>
      </div>
    </div>
  )
}

export function LocationGallery() {
  return (
    <div className="grid w-full max-w-md grid-cols-2 gap-3">
      {[
        { name: "Central", file: "central-suite.jpg" },
        { name: "Riverside", file: "riverside-bar.jpg" },
        { name: "Airport", file: "airport-lobby.jpg" },
        { name: "Central", file: "central-breakfast.jpg" },
      ].map((p) => (
        <div key={p.file} className="flex flex-col gap-2">
          <AspectRatio ratio={4 / 3} className="overflow-hidden rounded-xl border border-border">
            <PhotoBlock label={p.name} />
          </AspectRatio>
          <span className="font-mono text-xs text-muted-foreground">{p.file}</span>
        </div>
      ))}
    </div>
  )
}
