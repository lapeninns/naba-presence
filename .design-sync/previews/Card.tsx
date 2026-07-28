import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "NabaReview"
import { Star, TrendingUp } from "lucide-react"

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={i <= value ? "size-4 fill-rating text-rating" : "size-4 text-muted-foreground/40"}
        />
      ))}
    </span>
  )
}

export function ReviewCard() {
  return (
    <Card className="max-w-md">
      <CardHeader>
        <div className="flex items-start gap-3">
          <Avatar>
            <AvatarFallback>PS</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="text-base">Priya Sharma</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Stars value={5} />
              <span className="text-xs text-muted-foreground">2 days ago</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-sm text-foreground">
          Stayed two nights and the front desk could not have been kinder. The room was
          spotless and breakfast was genuinely good.
        </CardDescription>
      </CardContent>
      <CardFooter className="gap-2">
        <Button>Post reply</Button>
        <Button variant="ghost">Save draft</Button>
      </CardFooter>
    </Card>
  )
}

export function WithAction() {
  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Lapen Inn — Central</CardTitle>
        <CardDescription>128 reviews across the last 90 days.</CardDescription>
        <CardAction>
          <Badge variant="secondary">Connected</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Reviews sync from Google Business Profile every 15 minutes. The last sync
        completed 4 minutes ago.
      </CardContent>
    </Card>
  )
}

export function Metric() {
  return (
    <Card className="max-w-xs">
      <CardHeader>
        <CardDescription>Average rating</CardDescription>
        <CardTitle className="text-3xl tabular-nums">4.6</CardTitle>
        <CardAction>
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <TrendingUp className="size-4" />
            +0.3
          </span>
        </CardAction>
      </CardHeader>
      <CardFooter>
        <span className="text-xs text-muted-foreground">Up from 4.3 last quarter</span>
      </CardFooter>
    </Card>
  )
}
