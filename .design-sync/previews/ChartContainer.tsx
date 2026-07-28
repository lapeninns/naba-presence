import { ChartContainer, ChartLegendContent, ChartTooltipContent } from "NabaReview"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

// Sizing note: the chart is given an explicit width/height rather than being
// left to ResponsiveContainer. The DS ships its own recharts copy inside
// _ds_bundle.js while this preview bundles a second one, so the
// ResponsiveContainer context does not cross the boundary — an unsized chart
// measures -1 and renders nothing. Fixed dimensions also make the capture
// deterministic. Keep W at/below the container width so grid cells don't clip.
const W = 384
const H = 224

const weeklyConfig = {
  received: { label: "Reviews received", color: "var(--chart-1)" },
  replied: { label: "Replies posted", color: "var(--chart-4)" },
}

const weekly = [
  { week: "Apr 8", received: 34, replied: 29 },
  { week: "Apr 15", received: 41, replied: 38 },
  { week: "Apr 22", received: 27, replied: 26 },
  { week: "Apr 29", received: 46, replied: 39 },
  { week: "May 6", received: 52, replied: 48 },
  { week: "May 13", received: 38, replied: 36 },
]

export function ReviewsPerWeek() {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">Reviews per week</span>
      <span className="text-xs text-muted-foreground">All locations · last 6 weeks</span>
      <ChartContainer config={weeklyConfig} className="h-56 w-96">
        <BarChart
          width={W}
          height={H}
          data={weekly}
          margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={false} content={<ChartTooltipContent />} />
          <Legend content={<ChartLegendContent />} />
          <Bar
            dataKey="received"
            fill="var(--color-received)"
            radius={4}
            isAnimationActive={false}
          />
          <Bar
            dataKey="replied"
            fill="var(--color-replied)"
            radius={4}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

const ratingConfig = {
  count: { label: "Reviews" },
}

// Colour carries meaning here (good → poor), but the category axis labels are
// what actually identify each bar.
const ratings = [
  { stars: "5 star", count: 74, fill: "var(--chart-4)" },
  { stars: "4 star", count: 31, fill: "var(--chart-5)" },
  { stars: "3 star", count: 12, fill: "var(--chart-3)" },
  { stars: "2 star", count: 7, fill: "var(--chart-2)" },
  { stars: "1 star", count: 4, fill: "var(--chart-2)" },
]

export function RatingDistribution() {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">Rating distribution</span>
      <span className="text-xs text-muted-foreground">128 reviews · last 90 days</span>
      <ChartContainer config={ratingConfig} className="h-56 w-96">
        <BarChart
          width={W}
          height={H}
          data={ratings}
          layout="vertical"
          margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis type="number" dataKey="count" tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="stars"
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
          <Bar dataKey="count" radius={4} barSize={18} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

const locationConfig = {
  central: { label: "Central", color: "var(--chart-1)" },
  riverside: { label: "Riverside", color: "var(--chart-5)" },
  airport: { label: "Airport", color: "var(--chart-4)" },
}

const replyRate = [
  { month: "Dec", central: 82, riverside: 61, airport: 90 },
  { month: "Jan", central: 85, riverside: 66, airport: 92 },
  { month: "Feb", central: 88, riverside: 63, airport: 95 },
  { month: "Mar", central: 91, riverside: 72, airport: 96 },
  { month: "Apr", central: 93, riverside: 77, airport: 98 },
  { month: "May", central: 95, riverside: 81, airport: 100 },
]

export function ReplyRateByLocation() {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">Reply rate by location</span>
      <span className="text-xs text-muted-foreground">Percent answered within 7 days</span>
      <ChartContainer config={locationConfig} className="h-56 w-96">
        <LineChart
          width={W}
          height={H}
          data={replyRate}
          margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            domain={[50, 100]}
            ticks={[50, 75, 100]}
          />
          <Tooltip cursor={false} content={<ChartTooltipContent />} />
          <Legend content={<ChartLegendContent />} />
          <Line
            dataKey="central"
            stroke="var(--color-central)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="riverside"
            stroke="var(--color-riverside)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="airport"
            stroke="var(--color-airport)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  )
}

const dailyConfig = {
  reviews: { label: "New reviews", color: "var(--chart-1)" },
}

const daily = [
  { day: "Mon", reviews: 6 },
  { day: "Tue", reviews: 9 },
  { day: "Wed", reviews: 5 },
  { day: "Thu", reviews: 12 },
  { day: "Fri", reviews: 17 },
  { day: "Sat", reviews: 21 },
  { day: "Sun", reviews: 14 },
]

// `defaultIndex` pins the tooltip open without a pointer — the only way to see
// ChartTooltipContent in a static capture.
export function WithPinnedTooltip() {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">New reviews this week</span>
      <span className="text-xs text-muted-foreground">Lapen Inn — Central</span>
      <ChartContainer config={dailyConfig} className="h-56 w-96">
        <AreaChart
          width={W}
          height={H}
          data={daily}
          margin={{ top: 24, right: 12, left: -20, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width={44} />
          <Tooltip
            defaultIndex={3}
            cursor={false}
            content={<ChartTooltipContent indicator="line" />}
          />
          <Area
            dataKey="reviews"
            stroke="var(--color-reviews)"
            fill="var(--color-reviews)"
            fillOpacity={0.18}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}
