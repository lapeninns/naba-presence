import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
} from "NabaReview"
import { CheckCircle2, Clock, CloudOff, ShieldAlert, Sparkles } from "lucide-react"

export function Variants() {
  return (
    <div className="flex max-w-md flex-col gap-3">
      <Alert>
        <CheckCircle2 />
        <AlertTitle>Reply published</AlertTitle>
        <AlertDescription>
          Google moderation: APPROVED · response time under 1 hour.
        </AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <CloudOff />
        <AlertTitle>Google sync failed</AlertTitle>
        <AlertDescription>
          Reconnect the Lapen Inn Riverside profile to resume importing reviews.
        </AlertDescription>
      </Alert>
    </div>
  )
}

export function WithAction() {
  return (
    <Alert variant="destructive" className="max-w-md">
      <ShieldAlert />
      <AlertTitle>Reconnect required</AlertTitle>
      <AlertDescription>
        The access token for Lapen Inn Riverside expired 3 days ago.
      </AlertDescription>
      <AlertAction>
        <Button size="xs" variant="outline">
          Reconnect
        </Button>
      </AlertAction>
    </Alert>
  )
}

export function TitleOnly() {
  return (
    <Alert className="max-w-md">
      <Clock />
      <AlertTitle>3 reviews are awaiting a reply for more than 48 hours</AlertTitle>
    </Alert>
  )
}

export function WithoutIcon() {
  return (
    <Alert className="max-w-md">
      <AlertTitle>Retention window</AlertTitle>
      <AlertDescription>
        Raw Google review text is purged 30 days after import. Aggregates and
        published replies are kept indefinitely.
      </AlertDescription>
    </Alert>
  )
}

export function WithLink() {
  return (
    <Alert className="max-w-md">
      <Sparkles />
      <AlertTitle>Suggested replies are on for Central</AlertTitle>
      <AlertDescription>
        Drafts still need a person to publish them. <a href="#">Review the reply policy</a>
        {" "}before enabling direct publishing.
      </AlertDescription>
    </Alert>
  )
}
