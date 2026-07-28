import {
  Badge,
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "NabaReview"
import type { ReactNode } from "react"
import {
  Building2,
  ChartColumn,
  Clock,
  MessageSquareReply,
  Plane,
  Sparkles,
  Star,
  TriangleAlert,
  Waves,
} from "lucide-react"

function PanelLink({
  title,
  description,
  meta,
  icon,
}: {
  title: string
  description: string
  meta?: ReactNode
  icon?: ReactNode
}) {
  return (
    <NavigationMenuLink render={<a href="#" />} className="items-start gap-2.5">
      {icon ? (
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {meta}
        </span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </NavigationMenuLink>
  )
}

function Rating({ value }: { value: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground">
      <Star className="size-3 fill-rating text-rating" />
      {value}
    </span>
  )
}

const REVIEW_LINKS = [
  {
    title: "Awaiting reply",
    description: "12 reviews need a response — oldest is 4 days old",
    meta: (
      <Badge variant="secondary" className="font-mono">
        12
      </Badge>
    ),
    icon: <MessageSquareReply />,
  },
  {
    title: "Escalations",
    description: "3 open — every 1★ and 2★ review lands here",
    meta: (
      <Badge variant="destructive" className="font-mono">
        3
      </Badge>
    ),
    icon: <TriangleAlert />,
  },
  {
    title: "Replied this week",
    description: "41 replies published across all three inns",
    icon: <Clock />,
  },
  {
    title: "Draft replies",
    description: "5 drafts waiting on duty-manager approval",
    icon: <Sparkles />,
  },
]

const LOCATION_LINKS = [
  {
    title: "Lapen Inn — Central",
    description: "12 King Street · 64 reviews · 6 awaiting reply",
    meta: <Rating value="4.7" />,
    icon: <Building2 />,
  },
  {
    title: "Lapen Inn — Riverside",
    description: "40 Mill Lane · 39 reviews · 9 awaiting reply",
    meta: <Rating value="4.4" />,
    icon: <Waves />,
  },
  {
    title: "Lapen Inn — Airport",
    description: "Terminal 2 Approach · 25 reviews · 2 awaiting reply",
    meta: <Rating value="4.8" />,
    icon: <Plane />,
  },
]

const REPORT_LINKS = [
  {
    title: "Response time",
    description: "Median 6h 20m, down from 11h in April",
  },
  {
    title: "Rating trend",
    description: "Rolling 90-day average by location",
  },
  {
    title: "Reply coverage",
    description: "88% of reviews answered within 48 hours",
  },
]

function SiteNav({ defaultValue }: { defaultValue?: string }) {
  return (
    <NavigationMenu defaultValue={defaultValue}>
      <NavigationMenuList>
        <NavigationMenuItem value="reviews">
          <NavigationMenuTrigger>
            Reviews
            <Badge variant="secondary" className="ml-1.5 font-mono">
              12
            </Badge>
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="m-0 grid list-none grid-cols-2 gap-1 p-0">
              {REVIEW_LINKS.map((link) => (
                <li className="w-64" key={link.title}>
                  <PanelLink {...link} />
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem value="locations">
          <NavigationMenuTrigger>Locations</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {LOCATION_LINKS.map((link) => (
                <li className="w-80" key={link.title}>
                  <PanelLink {...link} />
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem value="reports">
          <NavigationMenuTrigger>Reports</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="flex gap-1">
              <div className="w-56">
                <NavigationMenuLink
                  render={<a href="#" />}
                  className="h-full flex-col items-start justify-between gap-3 border border-border bg-muted"
                >
                  <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ChartColumn />
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-foreground">
                      May performance digest
                    </span>
                    <span className="text-xs text-muted-foreground">
                      128 reviews, 4.6 average and the three replies guests
                      quoted back to us.
                    </span>
                  </span>
                  <Badge variant="secondary">Ready to send</Badge>
                </NavigationMenuLink>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {REPORT_LINKS.map((link) => (
                  <li className="w-64" key={link.title}>
                    <PanelLink {...link} />
                  </li>
                ))}
              </ul>
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuLink render={<a href="#" />} className="h-9">
            Settings
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}

export function GlobalNav() {
  return (
    <div className="flex w-full items-center gap-6 border-b border-border pb-3">
      <span className="text-sm font-semibold">Lapen Inns</span>
      <SiteNav />
    </div>
  )
}

/* The open panel is portaled to document.body by NavigationMenuPositioner, so
   it escapes the card cell and is positioned from the trigger's viewport rect.
   That only works when ONE story is mounted at a time: with several open menus
   on the page the later positioners keep stale measurements (see
   .design-sync/learnings/wave2-L.md — this card needs cardMode "single"). */

export function ReviewsPanel() {
  return <SiteNav defaultValue="reviews" />
}

export function LocationsPanel() {
  return <SiteNav defaultValue="locations" />
}

export function ReportsPanel() {
  return <SiteNav defaultValue="reports" />
}
