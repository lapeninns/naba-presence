import { readFile } from "node:fs/promises"
import path from "node:path"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { KpiTile } from "@/components/ui/kpi-tile"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { auditTokens, type PairResult } from "@/lib/design/contrast-pairs"
import { parseTokens, type ThemeName } from "@/lib/design/tokens"

/**
 * The contrast gate, rendered. This server component reads the shipping
 * `app/globals.css` and measures every pair in `lib/design/contrast-pairs.ts`
 * with the same module `pnpm check:contrast` and the vitest gate use, so a
 * ratio printed here can never disagree with the one CI enforces — and a
 * hand-maintained table of hex values (which is what this replaced) can
 * never drift from the tokens again.
 */
const THEMES: ThemeName[] = ["light", "dark"]

function ratioLabel(value: number) {
  return `${value.toFixed(2)}:1`
}

function PairTable({ rows }: { rows: PairResult[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Where it is painted</TableHead>
          <TableHead>Foreground</TableHead>
          <TableHead>Background</TableHead>
          <TableHead numeric>Ratio</TableHead>
          <TableHead numeric>Floor</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.pair.fg}-${row.pair.bg}-${row.pair.kind}`}>
            <TableCell className="max-w-64 whitespace-normal">
              {row.pair.note}
            </TableCell>
            <TableCell className="font-mono text-caption text-ink-muted">
              {row.pair.fg}
            </TableCell>
            <TableCell className="font-mono text-caption text-ink-muted">
              {row.pair.bg}
            </TableCell>
            <TableCell numeric>{ratioLabel(row.ratio)}</TableCell>
            <TableCell numeric>{ratioLabel(row.minimum)}</TableCell>
            <TableCell>
              <StatusPill
                variant="inline"
                tone={row.passes ? "healthy" : "at-risk"}
              >
                {row.passes ? "Passes" : "Fails"}
              </StatusPill>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export async function ContrastEvidence() {
  const css = await readFile(
    path.join(process.cwd(), "app", "globals.css"),
    "utf8"
  )
  const report = auditTokens(parseTokens(css))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-(--np-gap-card) sm:grid-cols-2">
        {THEMES.map((theme) => {
          const rows = report.results.filter((row) => row.theme === theme)
          const passing = rows.filter((row) => row.passes).length
          const allPass = passing === rows.length
          return (
            <KpiTile
              key={theme}
              label={`${theme === "light" ? "Light" : "Dark"} theme pairs`}
              value={`${passing} / ${rows.length}`}
              hint={
                allPass
                  ? "Every pair clears its floor."
                  : `${rows.length - passing} below the floor.`
              }
              trailing={
                <StatusPill tone={allPass ? "healthy" : "at-risk"}>
                  {allPass ? "Passing" : "Failing"}
                </StatusPill>
              }
            />
          )
        })}
      </div>

      {report.issues.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Structural issues in the token file</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {report.issues.map((issue) => (
                <li key={`${issue.theme}-${issue.message}`}>
                  {issue.theme}: {issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {THEMES.map((theme) => (
        <details
          key={theme}
          className="rounded-(--np-radius-card) border border-line bg-surface"
          open={report.failures.some((row) => row.theme === theme)}
        >
          <summary className="cursor-default rounded-(--np-radius-card) px-(--np-card-pad) py-3 text-ui font-medium text-ink focus-halo select-none">
            Every {theme} pair, measured
          </summary>
          <div className="px-(--np-card-pad) pb-(--np-card-pad)">
            <PairTable
              rows={report.results.filter((row) => row.theme === theme)}
            />
          </div>
        </details>
      ))}
    </div>
  )
}
