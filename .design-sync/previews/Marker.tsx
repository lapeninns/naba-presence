import {
  Bubble,
  BubbleContent,
  Marker,
  MarkerContent,
  MarkerIcon,
} from "NabaReview"
import {
  FileSpreadsheet,
  MessageSquareQuote,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react"

export function CitedSource() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-3">
      <p className="text-sm leading-relaxed text-foreground">
        Thank you for telling us, Lena. A 40-minute check-in is not the arrival we
        want to give anyone, and I am sorry the courtyard bar kept you awake. The
        bar now closes at 22:30, and the front desk is double-staffed after 16:00.
      </p>
      <Marker>
        <MarkerIcon>
          <MessageSquareQuote />
        </MarkerIcon>
        <MarkerContent>
          Cited from <a href="#">Lena Fischer, 2 stars</a> &mdash; Lapen Inn
          Riverside, <span className="font-mono">14 May</span>
        </MarkerContent>
      </Marker>
    </div>
  )
}

export function ThreadDivider() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-3">
      <Bubble variant="muted">
        <BubbleContent>
          Airport is fully caught up — 25 of 25 reviews answered.
        </BubbleContent>
      </Bubble>
      <Marker variant="separator">
        <MarkerContent className="font-mono">Today &middot; 09:14</MarkerContent>
      </Marker>
      <Bubble align="end">
        <BubbleContent>What is still open at Riverside?</BubbleContent>
      </Bubble>
    </div>
  )
}

export function SourceList() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-2">
      <Marker variant="border">
        <MarkerIcon>
          <ShieldCheck className="text-success" />
        </MarkerIcon>
        <MarkerContent className="text-foreground">
          Verified against 2 sources before posting
        </MarkerContent>
      </Marker>
      <Marker>
        <MarkerIcon>
          <Star className="fill-rating text-rating" />
        </MarkerIcon>
        <MarkerContent>
          <a href="#">Lena Fischer &middot; 2 stars</a> &middot; Riverside &middot;{" "}
          <span className="font-mono">14 May</span>
        </MarkerContent>
      </Marker>
      <Marker>
        <MarkerIcon>
          <FileSpreadsheet />
        </MarkerIcon>
        <MarkerContent>
          reviews-riverside-may.csv &middot; row{" "}
          <span className="font-mono">118</span>
        </MarkerContent>
      </Marker>
    </div>
  )
}

export function InlineAnnotation() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-2">
      <Bubble variant="muted">
        <BubbleContent>
          &ldquo;Thank you for the kind words, Marco. I have passed them to the
          Airport front desk team &mdash; they will be glad the early breakfast was
          worth the 4am start.&rdquo;
        </BubbleContent>
      </Bubble>
      <Marker className="px-3">
        <MarkerIcon>
          <Sparkles />
        </MarkerIcon>
        <MarkerContent>
          Tone: appreciative &middot;{" "}
          <span className="font-mono">64</span> words &middot; no compensation
          offered
        </MarkerContent>
      </Marker>
    </div>
  )
}
