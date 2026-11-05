// Concept 3: data-heavy report: filters, KPI strip, chart, table.
import {
  SIZE,
  T,
  button,
  card,
  chip,
  col,
  conceptTag,
  h,
  icon,
  row,
  spacer,
  text,
} from "./kit.mjs"
import { appbar, rail, sidebar, tabbar, scopePill, topbar } from "./shell.mjs"

// 12 weeks of sample data: reviews received (context, grey) and replied on
// Google (the data hue). Replies never exceed reviews.
const WEEKS = [
  ["11 Aug", 18, 15],
  ["18 Aug", 22, 19],
  ["25 Aug", 25, 20],
  ["1 Sep", 19, 18],
  ["8 Sep", 24, 23],
  ["15 Sep", 31, 26],
  ["22 Sep", 27, 25],
  ["29 Sep", 21, 21],
  ["6 Oct", 29, 27],
  ["13 Oct", 34, 30],
  ["20 Oct", 28, 27],
  ["27 Oct", 36, 33],
]
const LISTINGS = [
  ["Riverside Rooms", "York", 96, "4.4", "92%", "3 h 10 min", 2],
  ["The Bell", "Malton", 81, "4.7", "100%", "1 h 45 min", 0],
  ["Harbour Kitchen", "Whitby", 74, "4.1", "88%", "6 h 20 min", 4],
  ["Mill House", "Helmsley", 52, "4.6", "96%", "2 h 05 min", 1],
  ["Station Hotel", "Pickering", 41, "3.9", "80%", "9 h 40 min", 5],
]

function kpiStrip(s, opts = {}) {
  const items = [
    ["Reviews", "314", "Up 18% on the previous 12 weeks", null],
    ["Replied on Google", "93%", "Up 4 points", "good"],
    ["Median reply time", "3 h 25 min", "Down 40 min", "good"],
    ["Average rating", "4.4", "No change · out of 5", null],
  ]
  const cell = ([label, value, delta, tone], i) =>
    col(
      {
        flexGrow: 1,
        gap: 4,
        padding: opts.compact ? "12px 14px" : "14px 18px",
        boxShadow: i ? `inset 1px 0 0 ${T.lineSubtle}` : undefined,
      },
      text({ fontSize: s.caption + 1, color: T.muted, fontWeight: 500 }, label),
      text(
        {
          fontSize: s.figure,
          fontWeight: 600,
          color: T.ink,
          letterSpacing: -0.2,
        },
        value
      ),
      row(
        { gap: 4 },
        tone
          ? icon(
              delta.startsWith("Up") ? "arrow-up-right" : "arrow-down-right",
              13,
              T.ink,
              2.25
            )
          : null,
        text(
          {
            fontSize: s.caption,
            color: tone ? T.ink : T.muted,
            fontWeight: tone ? 600 : 400,
          },
          delta
        )
      )
    )
  if (opts.grid)
    return card(
      { overflow: "hidden" },
      row(
        { boxShadow: `inset 0 -1px 0 ${T.lineSubtle}` },
        cell(items[0], 0),
        cell(items[1], 1)
      ),
      row({}, cell(items[2], 0), cell(items[3], 1))
    )
  return card({ flexDirection: "row", overflow: "hidden" }, ...items.map(cell))
}

function barChart(
  s,
  { width, height, weeks = WEEKS, labelEvery = 2, tooltip = false }
) {
  // y = 6 + plotH * (1 - v / max): gridlines, tick labels and bar tops all
  // use the same scale, so a label sits centred on its line.
  const max = 60
  const plotH = height - 30
  const gw = (width - 34) / weeks.length
  const bw = Math.max(5, Math.min(14, gw / 2 - 3))
  const y = (v) => 6 + plotH * (1 - v / max)
  return row(
    { width, height, alignItems: "flex-start", gap: 0 },
    col(
      { width: 30, height: plotH + 6, position: "relative" },
      ...[60, 30, 0].map((v) =>
        text(
          {
            position: "absolute",
            right: 6,
            top: Math.round(y(v)) - 7,
            fontSize: 11,
            lineHeight: "14px",
            color: T.muted,
          },
          String(v)
        )
      )
    ),
    col(
      { flexGrow: 1, height, position: "relative" },
      // three recessive gridlines
      ...[0, 0.5, 1].map((f) =>
        h("div", {
          display: "flex",
          position: "absolute",
          left: 0,
          right: 0,
          top: Math.round(f * plotH) + 6,
          height: 1,
          background: f === 1 ? T.lineStrong : T.lineSubtle,
        })
      ),
      row(
        { height: plotH + 6, alignItems: "flex-end", width: "100%" },
        ...weeks.map(([, rec, rep]) =>
          row(
            {
              width: gw,
              justifyContent: "center",
              alignItems: "flex-end",
              gap: 2,
            },
            h("div", {
              display: "flex",
              width: bw,
              height: Math.round((rec / max) * plotH),
              background: T.chart3,
              borderRadius: "3px 3px 0 0",
            }),
            h("div", {
              display: "flex",
              width: bw,
              height: Math.round((rep / max) * plotH),
              background: T.chart1,
              borderRadius: "3px 3px 0 0",
            })
          )
        )
      ),
      row(
        { width: "100%", paddingTop: 6 },
        ...weeks.map(([w], i) =>
          text(
            {
              width: gw,
              justifyContent: "center",
              fontSize: 11,
              color: T.muted,
              whiteSpace: "nowrap",
            },
            i % labelEvery === 0 ? w : ""
          )
        )
      ),
      // Hover layer: the hovered week gets a fill-band and a tooltip in text tokens.
      tooltip
        ? h("div", {
            display: "flex",
            position: "absolute",
            left: gw * (weeks.length - 1),
            top: 0,
            width: gw,
            height: plotH + 6,
            background: "rgba(25,32,40,0.05)",
            borderRadius: 4,
          })
        : null,
      tooltip
        ? col(
            {
              position: "absolute",
              left: gw * (weeks.length - 1) - 190,
              top: 4,
              width: 180,
              padding: "8px 10px",
              gap: 4,
              background: T.surface,
              border: `1px solid ${T.line}`,
              borderRadius: T.rControl,
              boxShadow: T.shadowPop,
            },
            text(
              { fontSize: 12, fontWeight: 600, color: T.ink },
              "Week of 27 Oct"
            ),
            row(
              { gap: 6 },
              h("div", {
                display: "flex",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: T.chart3,
              }),
              text(
                { fontSize: 12, color: T.ink2, flexGrow: 1 },
                "Reviews received"
              ),
              text({ fontSize: 12, fontWeight: 600, color: T.ink }, "36")
            ),
            row(
              { gap: 6 },
              h("div", {
                display: "flex",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: T.chart1,
              }),
              text(
                { fontSize: 12, color: T.ink2, flexGrow: 1 },
                "Replied on Google"
              ),
              text({ fontSize: 12, fontWeight: 600, color: T.ink }, "33")
            )
          )
        : null
    )
  )
}

function legend(s) {
  const sw = (c, l) =>
    row(
      { gap: 6 },
      h("div", {
        display: "flex",
        width: 10,
        height: 10,
        borderRadius: 2,
        background: c,
      }),
      text({ fontSize: s.caption + 1, color: T.ink2 }, l)
    )
  return row(
    { gap: 16 },
    sw(T.chart3, "Reviews received"),
    sw(T.chart1, "Replied on Google")
  )
}

function chartCard(s, { width, height, labelEvery, tooltip }) {
  return card(
    { padding: "16px 18px", gap: 12 },
    row(
      { gap: 8, alignItems: "flex-start" },
      col(
        { gap: 3, flexGrow: 1 },
        text(
          { fontSize: s.title, fontWeight: 600, color: T.ink },
          "Reviews and replies by week"
        ),
        text(
          { fontSize: s.caption + 1, color: T.muted },
          "Week of 27 Oct: 36 reviews, 33 replied on Google"
        )
      ),
      button(s, "", {
        kind: "ghost",
        iconOnly: true,
        icon: "ellipsis",
        size: "sm",
      })
    ),
    legend(s),
    barChart(s, { width, height, labelEvery, tooltip })
  )
}

function filterBar(s) {
  const seg = row(
    { padding: 3, borderRadius: T.rControl + 2, background: T.fill, gap: 2 },
    ...["28 days", "90 days", "12 months", "18 months"].map((p, i) =>
      text(
        {
          padding: "0 10px",
          height: s.controlSm - 4,
          alignItems: "center",
          borderRadius: T.rControl,
          background: i === 1 ? T.surface : "transparent",
          fontSize: s.ui,
          fontWeight: i === 1 ? 600 : 500,
          color: i === 1 ? T.ink : T.ink2,
          boxShadow: i === 1 ? "0 1px 2px rgba(25,32,40,0.12)" : undefined,
        },
        p
      )
    )
  )
  return row(
    { gap: 10, flexWrap: "wrap", width: "100%" },
    seg,
    chip(s, "All 9 listings", { icon: "store" }),
    chip(s, "Compare: previous period", { icon: "git-compare" }),
    spacer()
  )
}

function table(s) {
  const cols = [
    ["Listing", 220, "left"],
    ["Reviews", 90, "right"],
    ["Rating", 80, "right"],
    ["Replied", 90, "right"],
    ["Median reply", 120, "right"],
    ["Needs reply", 90, "right"],
  ]
  return card(
    { overflow: "hidden" },
    row(
      { padding: "0 18px", height: 40, boxShadow: `inset 0 -1px 0 ${T.line}` },
      ...cols.map(([c, w, a], i) =>
        text(
          {
            width: w,
            flexGrow: i === 0 ? 1 : 0,
            justifyContent: a === "right" ? "flex-end" : "flex-start",
            fontSize: s.caption + 1,
            fontWeight: 500,
            color: T.muted,
          },
          c
        )
      )
    ),
    ...LISTINGS.map(([name, town, rev, rat, repl, med, wait]) =>
      row(
        {
          padding: "0 18px",
          height: 46,
          boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
        },
        col(
          { width: 220, flexGrow: 1, gap: 1 },
          text({ fontSize: s.body, fontWeight: 600, color: T.ink }, name),
          text({ fontSize: s.caption, color: T.muted }, town)
        ),
        ...[rev, rat, repl, med].map((v, i) =>
          text(
            {
              width: cols[i + 1][1],
              justifyContent: "flex-end",
              fontSize: s.body,
              color: T.ink,
            },
            String(v)
          )
        ),
        text(
          {
            width: 90,
            justifyContent: "flex-end",
            fontSize: s.body,
            color: wait ? T.ink : T.muted,
            fontWeight: wait > 3 ? 600 : 400,
          },
          wait ? String(wait) : "0"
        )
      )
    ),
    row(
      { padding: "10px 18px", gap: 10 },
      text(
        { fontSize: s.caption + 1, color: T.muted, flexGrow: 1 },
        "Showing 5 of 9 listings · sorted by reviews"
      ),
      button(s, "Previous", { kind: "secondary", size: "sm" }),
      button(s, "Next", { kind: "secondary", size: "sm" })
    )
  )
}

function reportHeader(s, opts = {}) {
  return col(
    { gap: 6 },
    row(
      { gap: 10 },
      text(
        { fontSize: opts.size ?? 26, fontWeight: 700, color: T.ink },
        "Reports"
      ),
      spacer(),
      opts.actions ?? null
    ),
    text(
      { fontSize: s.body, color: T.muted },
      "Journey Hospitality · 4 Aug to 2 Nov · Google data as at 2 Nov, 06:00"
    )
  )
}

function tabsRow(s) {
  return row(
    {
      gap: 22,
      height: 38,
      alignItems: "flex-end",
      boxShadow: `inset 0 -1px 0 ${T.line}`,
      width: "100%",
    },
    ...["Replies", "Google views and actions", "Search terms"].map((t, i) =>
      col(
        { gap: 9 },
        text(
          {
            fontSize: s.ui,
            fontWeight: i ? 500 : 600,
            color: i ? T.ink2 : T.ink,
          },
          t
        ),
        h("div", {
          display: "flex",
          height: 2,
          background: i ? "transparent" : T.ink,
          width: "100%",
        })
      )
    )
  )
}

export const report = {
  "report-desktop": {
    title: "Reports · desktop 1440",
    width: 1440,
    height: 1100,
    build() {
      const s = SIZE.desk
      return row(
        { width: "100%", height: "100%", background: T.canvas },
        sidebar(s, "reports"),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, { trail: ["Reports"] }),
          col(
            { padding: "22px 32px", gap: 18 },
            reportHeader(s, {
              actions: row(
                { gap: 8 },
                button(s, "Download CSV", {
                  kind: "ghost",
                  icon: "download",
                  size: "sm",
                }),
                button(s, "Share report", {
                  kind: "secondary",
                  icon: "share-2",
                  size: "sm",
                })
              ),
            }),
            tabsRow(s),
            filterBar(s),
            kpiStrip(s),
            chartCard(s, {
              width: 1050,
              height: 230,
              labelEvery: 1,
              tooltip: true,
            }),
            table(s)
          )
        ),
        conceptTag()
      )
    },
  },
  "report-tablet": {
    title: "Reports · tablet 834",
    width: 834,
    height: 1194,
    build() {
      const s = SIZE.touch
      return row(
        { width: "100%", height: "100%", background: T.canvas },
        rail(s, "reports"),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, { trail: ["Reports"], wide: false, scope: scopePill() }),
          col(
            { padding: "20px 24px", gap: 16 },
            reportHeader(s, {
              actions: button(s, "Share", {
                kind: "secondary",
                icon: "share-2",
                size: "sm",
              }),
            }),
            tabsRow(s),
            filterBar(s),
            kpiStrip(s, { grid: true }),
            chartCard(s, { width: 640, height: 220, labelEvery: 2 }),
            table(s)
          )
        ),
        conceptTag()
      )
    },
  },
  "report-phone": {
    title: "Reports · phone 390",
    width: 390,
    height: 1200,
    build() {
      const s = SIZE.touch
      return col(
        { width: "100%", height: "100%", background: T.canvas },
        appbar(s, {}),
        col(
          { flexGrow: 1, padding: "14px 16px", gap: 14, overflow: "hidden" },
          reportHeader(s, { size: 26 }),
          row(
            { gap: 8 },
            chip(s, "90 days", { on: true }),
            chip(s, "All 9 listings", { icon: "store" }),
            chip(s, "Compare", { icon: "git-compare" })
          ),
          row(
            {
              gap: 18,
              height: 40,
              alignItems: "flex-end",
              boxShadow: `inset 0 -1px 0 ${T.line}`,
            },
            ...["Replies", "Google", "Search terms"].map((t, i) =>
              col(
                { gap: 9 },
                text(
                  {
                    fontSize: 15,
                    fontWeight: i ? 500 : 600,
                    color: i ? T.ink2 : T.ink,
                  },
                  t
                ),
                h("div", {
                  display: "flex",
                  height: 2,
                  background: i ? "transparent" : T.ink,
                  width: "100%",
                })
              )
            )
          ),
          kpiStrip(s, { grid: true, compact: true }),
          chartCard(s, { width: 320, height: 190, labelEvery: 4 }),
          col(
            { gap: 0 },
            text(
              { fontSize: 17, fontWeight: 600, color: T.ink, paddingBottom: 8 },
              "By listing"
            ),
            card(
              { overflow: "hidden" },
              ...LISTINGS.slice(0, 4).map(([name, , rev, rat, repl, , wait]) =>
                row(
                  {
                    padding: "12px 14px",
                    gap: 10,
                    boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
                  },
                  col(
                    { flexGrow: 1, gap: 2 },
                    text({ fontSize: 16, fontWeight: 600, color: T.ink }, name),
                    text(
                      { fontSize: 13, color: T.muted },
                      `${rev} reviews · ${rat} · replied ${repl}`
                    )
                  ),
                  wait
                    ? text(
                        {
                          fontSize: 13,
                          fontWeight: 600,
                          color: T.ink2,
                          padding: "2px 8px",
                          borderRadius: T.pill,
                          background: T.fill,
                        },
                        `${wait} need reply`
                      )
                    : null,
                  icon("chevron-right", 18, T.muted)
                )
              )
            )
          )
        ),
        tabbar(s, "reports"),
        conceptTag("Concept · sample data", { left: 112, top: 14 })
      )
    },
  },
}
