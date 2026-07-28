import { Calendar } from "NabaReview"

// Every date is pinned: react-day-picker otherwise anchors on "today", which
// would make each re-capture differ. `today` is passed explicitly so the
// today-highlight is stable even if the capture clock ever moves.
const MAY_2024 = new Date(2024, 4, 1)
const TODAY = new Date(2024, 4, 15)

export function ReviewDate() {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">Review posted on</span>
      <Calendar
        mode="single"
        selected={new Date(2024, 4, 8)}
        defaultMonth={MAY_2024}
        today={TODAY}
        className="rounded-2xl border border-border"
      />
    </div>
  )
}

export function ReportRange() {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        Reply-rate report · <span className="font-mono">6 May – 19 May 2024</span>
      </span>
      <Calendar
        mode="range"
        selected={{ from: new Date(2024, 4, 6), to: new Date(2024, 4, 19) }}
        defaultMonth={MAY_2024}
        today={TODAY}
        className="rounded-2xl border border-border"
      />
    </div>
  )
}

export function MonthYearDropdowns() {
  return (
    <Calendar
      mode="single"
      captionLayout="dropdown"
      selected={new Date(2024, 4, 2)}
      defaultMonth={MAY_2024}
      today={TODAY}
      startMonth={new Date(2022, 0, 1)}
      endMonth={new Date(2024, 11, 1)}
      className="rounded-2xl border border-border"
    />
  )
}

export function UnrepliedWindow() {
  return (
    <div className="flex flex-col gap-2">
      <Calendar
        mode="single"
        selected={new Date(2024, 4, 13)}
        defaultMonth={MAY_2024}
        today={TODAY}
        disabled={{ after: TODAY }}
        className="rounded-2xl border border-border"
      />
      <span className="text-xs text-muted-foreground">
        Reviews only exist up to today — later days are disabled.
      </span>
    </div>
  )
}
