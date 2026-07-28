import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
  Kbd,
  KbdGroup,
  Switch,
} from "NabaReview"
import { Building2, MapPin, RefreshCw, Reply, Star } from "lucide-react"

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

export function ConnectedLocations() {
  return (
    <ItemGroup className="max-w-2xl">
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Building2 />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Lapen Inn — Central</ItemTitle>
          <ItemDescription>
            128 reviews · last synced 4 minutes ago
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="secondary">Connected</Badge>
        </ItemActions>
      </Item>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <MapPin />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Lapen Inn — Riverside</ItemTitle>
          <ItemDescription>39 reviews · last synced 12 minutes ago</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="secondary">Connected</Badge>
        </ItemActions>
      </Item>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <MapPin />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Lapen Inn — Airport</ItemTitle>
          <ItemDescription>
            Reconnect this profile to resume syncing reviews.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="destructive">Disconnected</Badge>
          <Button size="sm" variant="outline">
            <RefreshCw />
            Reconnect
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}

export function Variants() {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <Item>
        <ItemMedia variant="icon">
          <MapPin />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>default</ItemTitle>
          <ItemDescription>Transparent border — sits directly on the surface.</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <MapPin />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>outline</ItemTitle>
          <ItemDescription>Bordered row — use for selectable list entries.</ItemDescription>
        </ItemContent>
      </Item>
      <Item variant="muted">
        <ItemMedia variant="icon">
          <MapPin />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>muted</ItemTitle>
          <ItemDescription>Tinted row — use for read-only or secondary rows.</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Building2 />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Central</ItemTitle>
          <ItemDescription>size=default — 14px vertical padding.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="outline" className="font-mono tabular-nums">
            64
          </Badge>
        </ItemActions>
      </Item>
      <Item variant="outline" size="sm">
        <ItemMedia variant="icon">
          <Building2 />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Riverside</ItemTitle>
          <ItemDescription>size=sm</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="outline" className="font-mono tabular-nums">
            39
          </Badge>
        </ItemActions>
      </Item>
      <Item variant="outline" size="xs">
        <ItemMedia variant="icon">
          <Building2 />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Airport</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Badge variant="outline" className="font-mono tabular-nums">
            25
          </Badge>
        </ItemActions>
      </Item>
    </div>
  )
}

export function SearchResults() {
  return (
    <ItemGroup className="max-w-2xl">
      <Item variant="muted">
        <ItemMedia>
          <Avatar>
            <AvatarFallback>PS</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            Priya Sharma
            <Stars value={5} />
          </ItemTitle>
          <ItemDescription>
            &ldquo;Front desk held our room after a delayed flight — genuinely above
            and beyond.&rdquo;
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <span className="font-mono text-xs text-muted-foreground">Central · 2d</span>
        </ItemActions>
      </Item>
      <ItemSeparator />
      <Item variant="muted">
        <ItemMedia>
          <Avatar>
            <AvatarFallback>LF</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            Lena Fischer
            <Stars value={2} />
          </ItemTitle>
          <ItemDescription>
            &ldquo;Front desk was unstaffed for twenty minutes at check-in.&rdquo;
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <span className="font-mono text-xs text-muted-foreground">Riverside · 5d</span>
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}

export function WithHeaderAndFooter() {
  return (
    <Item variant="outline" className="max-w-2xl">
      <ItemHeader>
        <span className="text-xs font-medium text-muted-foreground">
          Awaiting reply · Riverside
        </span>
        <Badge variant="secondary">3d old</Badge>
      </ItemHeader>
      <ItemMedia>
        <Avatar>
          <AvatarFallback>TO</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          Tom Okafor
          <Stars value={4} />
        </ItemTitle>
        <ItemDescription>
          Comfortable bed and quiet room. Breakfast finished earlier than advertised,
          which caught us out on the second morning.
        </ItemDescription>
      </ItemContent>
      <ItemFooter>
        <KbdGroup className="text-muted-foreground">
          <Kbd>⌘</Kbd>
          <Kbd>⏎</Kbd>
          <span className="text-xs">to post</span>
        </KbdGroup>
        <Button size="sm">
          <Reply />
          Reply
        </Button>
      </ItemFooter>
    </Item>
  )
}

export function SettingsRows() {
  return (
    <ItemGroup className="max-w-2xl">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>Auto-sync reviews</ItemTitle>
          <ItemDescription>
            Pull new Google Business Profile reviews every 15 minutes.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch defaultChecked />
        </ItemActions>
      </Item>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>Escalate ratings below 3 stars</ItemTitle>
          <ItemDescription>
            Route low ratings to the duty manager instead of the reply queue.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch defaultChecked />
        </ItemActions>
      </Item>
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>Weekly digest email</ItemTitle>
          <ItemDescription>Sent Mondays at 08:00 to all location managers.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch />
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}
