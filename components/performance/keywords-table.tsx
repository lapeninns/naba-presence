import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { KeywordRow } from "@/lib/contracts/analytics"
import type { CsvCell } from "@/lib/reporting/csv"
import { formatKeywordImpressions } from "@/lib/reporting/keyword-impressions"

/**
 * The terms as CSV rows. Impressions as Google gave them: the lower bound,
 * with the upper bound and whether Google gave a range beside it, so the
 * file stays as honest as the "N+" on screen.
 */
export function keywordsCsv(keywords: KeywordRow[]): CsvCell[][] {
  return [
    [
      "Position by impressions (not a search ranking)",
      "Search term",
      "Impressions (at least)",
      "Impressions (at most)",
      "Range from Google",
    ],
    ...keywords.map((keyword) => [
      keyword.rank,
      keyword.keyword,
      keyword.impressions,
      keyword.upperBound,
      keyword.thresholded ? "yes" : "no",
    ]),
  ]
}

/**
 * Search terms by impressions (reference `keywords-table`): rank, the term
 * as the customer typed it, and the honest "N+" for thresholded volumes.
 *
 * Under 720px of its own width each row is a record card: the term as the
 * headline, the impressions figure trailing it, and one meta line with the
 * position. Wider, it is the three-column table.
 */
export function KeywordsTable({ keywords }: { keywords: KeywordRow[] }) {
  return (
    <Table surface responsive>
      <TableHeader>
        <TableRow>
          <TableHead numeric className="w-12">
            <span aria-hidden>#</span>
            <span className="sr-only">
              Position by impressions, not a search ranking
            </span>
          </TableHead>
          <TableHead>Search term</TableHead>
          <TableHead numeric>Impressions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keywords.map((keyword) => (
          <TableRow key={`${keyword.rank}-${keyword.keyword}`}>
            {/* The meta line on a card: "No. 3 by impressions". */}
            <TableCell
              numeric
              className="text-ink-muted @max-[720px]/table:col-span-full! @max-[720px]/table:row-start-2! @max-[720px]/table:text-caption"
            >
              <span className="@min-[720px]/table:hidden">No. </span>
              {keyword.rank}
              <span className="@min-[720px]/table:hidden"> by impressions</span>
            </TableCell>
            <TableCell
              className="font-medium break-words text-ink @max-[720px]/table:col-start-1! @max-[720px]/table:row-start-1! @max-[720px]/table:text-body"
              lang="und"
              dir="auto"
            >
              {keyword.keyword}
            </TableCell>
            <TableCell
              numeric
              className="@max-[720px]/table:col-start-2! @max-[720px]/table:row-start-1! @max-[720px]/table:text-right! @max-[720px]/table:text-body @max-[720px]/table:font-semibold"
            >
              <span>{formatKeywordImpressions(keyword)}</span>
              <span className="sr-only @min-[720px]/table:hidden">
                {" "}
                impressions
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
