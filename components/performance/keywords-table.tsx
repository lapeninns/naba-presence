import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { KeywordRow } from "@/lib/contracts/analytics"
import { formatKeywordImpressions } from "@/lib/reporting/keyword-impressions"

/**
 * Search terms by impressions (reference `keywords-table`): rank, the term
 * as the customer typed it, and the honest "N+" for thresholded volumes.
 * Labelled rows on a narrow container: the term on top, rank and
 * impressions side by side beneath it.
 */
export function KeywordsTable({ keywords }: { keywords: KeywordRow[] }) {
  return (
    <Table surface responsive>
      <TableHeader>
        <TableRow>
          <TableHead numeric className="w-12">
            #
          </TableHead>
          <TableHead>Search term</TableHead>
          <TableHead numeric>Impressions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keywords.map((keyword) => (
          <TableRow key={`${keyword.rank}-${keyword.keyword}`}>
            <TableCell
              numeric
              label="Rank"
              className="text-ink-muted @max-[720px]/table:col-span-1! @max-[720px]/table:row-start-2!"
            >
              {keyword.rank}
            </TableCell>
            <TableCell
              span
              label="Search term"
              className="font-medium break-words text-ink @max-[720px]/table:row-start-1!"
              lang="und"
              dir="auto"
            >
              {keyword.keyword}
            </TableCell>
            <TableCell
              numeric
              label="Impressions"
              className="@max-[720px]/table:col-start-2! @max-[720px]/table:row-start-2!"
            >
              {formatKeywordImpressions(keyword)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
