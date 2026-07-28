import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from "NabaReview"
import { ThumbsUp } from "lucide-react"

const VARIANTS = [
  {
    variant: "default" as const,
    label: "default",
    copy: "Post it — that reads much better, thanks.",
  },
  {
    variant: "secondary" as const,
    label: "secondary",
    copy: "Reply queued for Lapen Inn — Riverside.",
  },
  {
    variant: "muted" as const,
    label: "muted",
    copy: "I softened the opening and kept the apology to one sentence.",
  },
  {
    variant: "tinted" as const,
    label: "tinted",
    copy: "Suggested tone: apologetic, 60–80 words, no compensation.",
  },
  {
    variant: "outline" as const,
    label: "outline",
    copy: "Draft saved. It expires in 7 days if it is not posted.",
  },
  {
    variant: "ghost" as const,
    label: "ghost",
    copy: "Marco Silva’s 5-star review was already answered on 12 May.",
  },
  {
    variant: "destructive" as const,
    label: "destructive",
    copy: "Google rejected this reply — it contains a phone number.",
  },
]

export function ReplyThread() {
  return (
    <div className="w-full max-w-lg">
      <BubbleGroup className="gap-3">
        <Bubble align="end">
          <BubbleContent>
            Draft a reply to Lena Fischer’s 2-star review of Riverside.
          </BubbleContent>
        </Bubble>
        <Bubble variant="muted">
          <BubbleContent>
            “Thank you for telling us, Lena. A 40-minute check-in is not the
            arrival we want to give anyone, and I am sorry the courtyard bar kept
            you awake.”
          </BubbleContent>
        </Bubble>
        <Bubble align="end">
          <BubbleContent>Warmer, and name the new 22:30 closing time.</BubbleContent>
        </Bubble>
      </BubbleGroup>
    </div>
  )
}

export function Variants() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-3">
      {VARIANTS.map((v) => (
        <div key={v.label} className="flex flex-col gap-1">
          <span className="font-mono text-xs text-muted-foreground">{v.label}</span>
          <Bubble variant={v.variant}>
            <BubbleContent>{v.copy}</BubbleContent>
          </Bubble>
        </div>
      ))}
    </div>
  )
}

export function WithReactions() {
  return (
    <div className="w-full max-w-lg pt-2 pb-6">
      <BubbleGroup className="gap-6">
        <Bubble variant="muted">
          <BubbleContent>
            Riverside’s reply rate is 77% this month — six reviews are still
            waiting, and four of them are 2 stars or lower.
          </BubbleContent>
          <BubbleReactions align="start">
            <ThumbsUp className="size-3.5" />
            <span className="font-mono text-xs">3</span>
          </BubbleReactions>
        </Bubble>
        <Bubble align="end">
          <BubbleContent>Queue the four low-rated ones for me.</BubbleContent>
          <BubbleReactions>
            <span className="text-xs">Seen</span>
          </BubbleReactions>
        </Bubble>
      </BubbleGroup>
    </div>
  )
}

export function Grouped() {
  return (
    <div className="w-full max-w-lg">
      <BubbleGroup>
        <Bubble variant="muted">
          <BubbleContent>Pulled 38 new reviews across the three properties.</BubbleContent>
        </Bubble>
        <Bubble variant="muted">
          <BubbleContent>
            Central 21, Riverside 11, Airport 6. Average 4.4 stars.
          </BubbleContent>
        </Bubble>
        <Bubble variant="muted">
          <BubbleContent>
            Two need a human: Lena Fischer (2 stars) and Tom Okafor (3 stars).
          </BubbleContent>
        </Bubble>
        <Bubble align="end">
          <BubbleContent>Start with Lena.</BubbleContent>
        </Bubble>
      </BubbleGroup>
    </div>
  )
}
