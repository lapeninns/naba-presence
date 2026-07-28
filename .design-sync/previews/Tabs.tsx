import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from "NabaReview"
import { Star } from "lucide-react"

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={i <= value ? "size-3.5 fill-rating text-rating" : "size-3.5 text-muted-foreground/40"}
        />
      ))}
    </span>
  )
}

function QueueRow({
  name,
  location,
  rating,
  age,
}: {
  name: string
  location: string
  rating: number
  age: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <span className="text-xs text-muted-foreground">{location}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Stars value={rating} />
        <span className="font-mono text-xs text-muted-foreground">{age}</span>
      </div>
    </div>
  )
}

export function ReviewQueue() {
  return (
    <Tabs defaultValue="awaiting" className="w-full max-w-sm">
      <TabsList>
        <TabsTrigger value="all">All reviews</TabsTrigger>
        <TabsTrigger value="awaiting">Awaiting reply</TabsTrigger>
        <TabsTrigger value="escalated">Escalated</TabsTrigger>
        <TabsTrigger value="replied">Replied</TabsTrigger>
      </TabsList>
      <TabsContent value="all" className="flex flex-col gap-3 pt-2">
        <QueueRow name="Priya Sharma" location="Central" rating={5} age="2d" />
        <QueueRow name="Tom Okafor" location="Riverside" rating={4} age="3d" />
      </TabsContent>
      <TabsContent value="awaiting" className="flex flex-col gap-3 pt-2">
        <QueueRow name="Tom Okafor" location="Riverside" rating={4} age="3d" />
        <QueueRow name="Marco Silva" location="Airport" rating={5} age="4d" />
      </TabsContent>
      <TabsContent value="escalated" className="flex flex-col gap-3 pt-2">
        <QueueRow name="Lena Fischer" location="Central" rating={2} age="5d" />
      </TabsContent>
      <TabsContent value="replied" className="flex flex-col gap-3 pt-2">
        <QueueRow name="Priya Sharma" location="Central" rating={5} age="2d" />
      </TabsContent>
    </Tabs>
  )
}

export function LineVariant() {
  return (
    <Tabs defaultValue="reply" className="w-full max-w-sm">
      <TabsList variant="line">
        <TabsTrigger value="review">Review</TabsTrigger>
        <TabsTrigger value="reply">Reply</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="review" className="pt-2 text-sm text-muted-foreground">
        Lena Fischer rated Lapen Inn Central 2 stars 5 days ago.
      </TabsContent>
      <TabsContent value="reply" className="pt-2">
        <p className="text-sm text-foreground">
          Thank you for the detailed note, Lena — the late check-in desk is now staffed
          until 1am and we would like to make the next stay right.
        </p>
        <p className="pt-2 font-mono text-xs text-muted-foreground">Draft saved 14:02</p>
      </TabsContent>
      <TabsContent value="history" className="pt-2 text-sm text-muted-foreground">
        Escalated to the Central duty manager on 12 Mar.
      </TabsContent>
    </Tabs>
  )
}

export function WithCounts() {
  return (
    <Tabs defaultValue="awaiting" className="w-full max-w-sm">
      <TabsList>
        <TabsTrigger value="awaiting">
          Awaiting
          <Badge variant="secondary">12</Badge>
        </TabsTrigger>
        <TabsTrigger value="escalated">
          Escalated
          <Badge variant="destructive">3</Badge>
        </TabsTrigger>
        <TabsTrigger value="replied">
          Replied
          <Badge variant="ghost">98</Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="awaiting" className="pt-2 text-sm text-muted-foreground">
        12 reviews have waited longer than 24 hours for a reply.
      </TabsContent>
      <TabsContent value="escalated" className="pt-2 text-sm text-muted-foreground">
        3 reviews are with a duty manager.
      </TabsContent>
      <TabsContent value="replied" className="pt-2 text-sm text-muted-foreground">
        98 replies published in the last 30 days.
      </TabsContent>
    </Tabs>
  )
}

export function Vertical() {
  return (
    <Tabs orientation="vertical" defaultValue="central" className="w-full max-w-sm">
      <TabsList>
        <TabsTrigger value="central">Central</TabsTrigger>
        <TabsTrigger value="riverside">Riverside</TabsTrigger>
        <TabsTrigger value="airport">Airport</TabsTrigger>
      </TabsList>
      <TabsContent value="central" className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">Lapen Inn Central</span>
        <span className="text-xs text-muted-foreground">64 reviews · avg 4.7</span>
      </TabsContent>
      <TabsContent value="riverside" className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">Lapen Inn Riverside</span>
        <span className="text-xs text-muted-foreground">39 reviews · avg 4.4</span>
      </TabsContent>
      <TabsContent value="airport" className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">Lapen Inn Airport</span>
        <span className="text-xs text-muted-foreground">25 reviews · avg 4.8</span>
      </TabsContent>
    </Tabs>
  )
}

export function WithDisabledTab() {
  return (
    <Tabs defaultValue="queue" className="w-full max-w-sm">
      <TabsList>
        <TabsTrigger value="queue">Queue</TabsTrigger>
        <TabsTrigger value="templates">Templates</TabsTrigger>
        <TabsTrigger value="insights" disabled>
          Insights
        </TabsTrigger>
      </TabsList>
      <TabsContent value="queue" className="pt-2 text-sm text-muted-foreground">
        15 reviews across three locations need a reply.
      </TabsContent>
      <TabsContent value="templates" className="pt-2 text-sm text-muted-foreground">
        6 approved reply templates.
      </TabsContent>
      <TabsContent value="insights" className="pt-2 text-sm text-muted-foreground">
        Insights unlock once 90 days of review history has synced.
      </TabsContent>
    </Tabs>
  )
}
