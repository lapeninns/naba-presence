import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
} from "NabaReview"

export function ReplyPolicyFAQ() {
  return (
    <Accordion defaultValue={["sla"]} className="max-w-xl">
      <AccordionItem value="sla">
        <AccordionTrigger>How fast do we have to reply?</AccordionTrigger>
        <AccordionContent className="text-muted-foreground">
          <p>
            One- and two-star reviews are answered within 4 hours during desk hours and by
            10:00 the next morning otherwise. Everything else has a 24-hour target.
          </p>
          <p>
            The countdown starts when Google publishes the review, not when it syncs into
            NabaReview.
          </p>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="tone">
        <AccordionTrigger>Can I edit a suggested reply?</AccordionTrigger>
        <AccordionContent className="text-muted-foreground">
          <p>
            Always. Suggested replies are a starting point — name the guest, name the thing
            that went wrong, and say what changes. Never paste the same paragraph twice at
            the same location.
          </p>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="escalate">
        <AccordionTrigger>When does a review get escalated?</AccordionTrigger>
        <AccordionContent className="text-muted-foreground">
          <p>
            Anything alleging a safety issue, a billing dispute over &euro;250, or
            discrimination goes to the duty manager before a public reply is posted.
          </p>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="removal">
        <AccordionTrigger>How do I flag a fake review?</AccordionTrigger>
        <AccordionContent className="text-muted-foreground">
          <p>
            Flag it from the review row, pick a Google policy reason, and add one line of
            evidence. Google decides in 3&ndash;10 days; the review stays public meanwhile.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

export function PerLocationSettings() {
  return (
    <Accordion defaultValue={["central", "riverside"]} className="max-w-xl">
      <AccordionItem value="central">
        <AccordionTrigger>
          <span className="flex flex-1 items-center justify-between gap-3 pr-2">
            Lapen Inn &mdash; Central
            <Badge variant="secondary">12 awaiting reply</Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Sync interval</dt>
              <dd className="font-mono">15 min</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Last sync</dt>
              <dd className="font-mono">09:41</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Reply owner</dt>
              <dd>Front desk</dd>
            </div>
          </dl>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="riverside">
        <AccordionTrigger>
          <span className="flex flex-1 items-center justify-between gap-3 pr-2">
            Lapen Inn &mdash; Riverside
            <Badge variant="secondary">4 awaiting reply</Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Sync interval</dt>
              <dd className="font-mono">15 min</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Last sync</dt>
              <dd className="font-mono">09:38</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Reply owner</dt>
              <dd>Lena Fischer</dd>
            </div>
          </dl>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="airport">
        <AccordionTrigger>
          <span className="flex flex-1 items-center justify-between gap-3 pr-2">
            Lapen Inn &mdash; Airport
            <Badge variant="secondary">All replied</Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Sync interval</dt>
              <dd className="font-mono">60 min</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Reply owner</dt>
              <dd>Marco Silva</dd>
            </div>
          </dl>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

export function WithDisabledSection() {
  return (
    <Accordion defaultValue={["connected"]} className="max-w-xl">
      <AccordionItem value="connected">
        <AccordionTrigger>Connected profiles</AccordionTrigger>
        <AccordionContent className="text-muted-foreground">
          <p>
            Central and Riverside are linked to the Lapen Inns Google Business Profile group.
            Reviews, photos and Q&amp;A sync on the same schedule.
          </p>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="pending" disabled>
        <AccordionTrigger>
          <span className="flex flex-1 items-center justify-between gap-3 pr-2">
            Airport &mdash; verification pending
            <Badge variant="secondary">Locked</Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent className="text-muted-foreground">
          <p>Settings unlock once Google confirms the postcard.</p>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="webhooks">
        <AccordionTrigger>Webhooks</AccordionTrigger>
        <AccordionContent className="text-muted-foreground">
          <p>
            One endpoint is receiving <span className="font-mono">review.created</span> and{" "}
            <span className="font-mono">review.replied</span>.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
