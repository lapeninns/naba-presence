import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "NabaReview"
import { Star } from "lucide-react"

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

const REVIEWS = [
  { name: "Priya Sharma", location: "Central", rating: 5, status: "Replied", age: "2d" },
  { name: "Tom Okafor", location: "Riverside", rating: 4, status: "Awaiting reply", age: "3d" },
  { name: "Lena Fischer", location: "Central", rating: 2, status: "Escalated", age: "5d" },
  { name: "Marco Silva", location: "Airport", rating: 5, status: "Replied", age: "1w" },
]

function Status({ value }: { value: string }) {
  if (value === "Replied") return <span className="text-success">{value}</span>
  if (value === "Escalated") return <span className="text-destructive">{value}</span>
  return <span className="text-muted-foreground">{value}</span>
}

export function ReviewQueue() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reviewer</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Rating</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Age</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {REVIEWS.map((r) => (
          <TableRow key={r.name}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-muted-foreground">{r.location}</TableCell>
            <TableCell>
              <Stars value={r.rating} />
            </TableCell>
            <TableCell>
              <Status value={r.status} />
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              {r.age}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function WithCaptionAndFooter() {
  return (
    <Table>
      <TableCaption>Reply performance by location, last 30 days.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Location</TableHead>
          <TableHead className="text-right">Reviews</TableHead>
          <TableHead className="text-right">Replied</TableHead>
          <TableHead className="text-right">Avg rating</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Central</TableCell>
          <TableCell className="text-right font-mono">64</TableCell>
          <TableCell className="text-right font-mono">58</TableCell>
          <TableCell className="text-right font-mono">4.7</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Riverside</TableCell>
          <TableCell className="text-right font-mono">39</TableCell>
          <TableCell className="text-right font-mono">30</TableCell>
          <TableCell className="text-right font-mono">4.4</TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Airport</TableCell>
          <TableCell className="text-right font-mono">25</TableCell>
          <TableCell className="text-right font-mono">25</TableCell>
          <TableCell className="text-right font-mono">4.8</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-medium">Total</TableCell>
          <TableCell className="text-right font-mono">128</TableCell>
          <TableCell className="text-right font-mono">113</TableCell>
          <TableCell className="text-right font-mono">4.6</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}

export function WithStatusBadges() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reviewer</TableHead>
          <TableHead>Rating</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Priya Sharma</TableCell>
          <TableCell>
            <Stars value={5} />
          </TableCell>
          <TableCell>
            <Badge variant="secondary">Replied</Badge>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Lena Fischer</TableCell>
          <TableCell>
            <Stars value={2} />
          </TableCell>
          <TableCell>
            <Badge variant="destructive">Escalated</Badge>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
