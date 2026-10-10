import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { after } from "next/server"

import { SharedClientReportView } from "@/components/share/shared-client-report"
import { parseSharePeriod } from "@/lib/contracts/report-shares"
import { checkAbuseBudget, clientIpFromHeaders } from "@/lib/server/abuse-limits"
import { withTenant } from "@/lib/server/db"
import {
  recordReportShareView,
  resolveReportShare,
} from "@/lib/server/report-shares"
import { loadSharedClientReport } from "@/lib/server/shared-report"

// Every request is resolved against the database: a link revoked a second
// ago must stop working at once, and one client's figures must never be
// served from a cache to another request.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * `/share/report/[token]`: one client's report for someone with no account.
 *
 * The only inputs are the token in the path and `?period=` from a fixed
 * allowlist; no other query parameter is read, so nothing in the address can
 * widen what is shown. The token resolves (lookup_report_share, live links
 * only) to an organisation and a client, and the report is read inside that
 * organisation's tenant transaction by the same loaders as Reports, narrowed
 * to that one client (lib/server/shared-report.ts). An unknown, expired or
 * revoked token -- and a client archived since -- all end in the same
 * notFound(), before anything is streamed, so the answer is a 404.
 *
 * Lookups are counted per client IP first (report_share in
 * lib/server/abuse-limits.ts). A page cannot answer 429, and a distinct
 * "slow down" page would tell a token prober it had been noticed, so an
 * address over the limit gets the same notFound() until its window ends.
 */
export default async function SharedReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ token }, query, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ])
  const budget = await checkAbuseBudget("report_share", {
    ip: clientIpFromHeaders(requestHeaders),
  })
  if (!budget.allowed) notFound()
  const share = await resolveReportShare(token)
  if (!share) notFound()

  const period = parseSharePeriod(query.period)
  const report = await withTenant(share.organisationId, (sql) =>
    loadSharedClientReport(sql, share, period)
  )
  if (!report) notFound()

  // After the response: counting a view must never slow or fail the report.
  after(() => recordReportShareView(share))

  return <SharedClientReportView report={report} />
}
