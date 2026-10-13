import { ReportsSkeleton } from "@/components/reporting/reports-skeleton"

// The report's own shapes inside the page frame's paddings, so the page
// streams in without the layout moving.
export default function PerformanceLoading() {
  return <ReportsSkeleton />
}
