// Concept 2: listing editor (opening hours) + review-and-publish lifecycle.
import {
  SIZE,
  T,
  button,
  card,
  changeTrack,
  col,
  conceptTag,
  dispatchBar,
  divider,
  h,
  homeIndicatorDark,
  icon,
  row,
  spacer,
  statusPill,
  text,
} from "./kit.mjs"
import { appbar, rail, sidebar, scopePill, topbar } from "./shell.mjs"

const DAYS = [
  ["Monday", "12:00 – 22:00"],
  ["Tuesday", "12:00 – 22:00"],
  ["Wednesday", "12:00 – 22:00"],
  ["Thursday", "12:00 – 22:00"],
  ["Friday", "12:00 – 23:00", "12:00 – 22:00"],
  ["Saturday", "10:00 – 23:00", "Closed"],
  ["Sunday", "10:00 – 18:00"],
]

function toggle(on) {
  return row(
    {
      width: 40,
      height: 24,
      borderRadius: 12,
      padding: 2,
      background: on ? T.ink : T.lineStrong,
      justifyContent: on ? "flex-end" : "flex-start",
    },
    h("div", {
      display: "flex",
      width: 20,
      height: 20,
      borderRadius: 10,
      background: "#fff",
    })
  )
}

function timeBox(s, v, edited) {
  return text(
    {
      height: s.controlSm,
      padding: "0 10px",
      alignItems: "center",
      borderRadius: T.rControl,
      border: `1px solid ${edited ? T.ink : T.lineStrong}`,
      background: T.surface,
      fontSize: s.ui,
      color: T.ink,
      fontWeight: edited ? 600 : 400,
    },
    v
  )
}

function dayRow(s, [day, hours, was], opts = {}) {
  const edited = !!was
  const [o, c] = hours.split(" – ")
  return row(
    {
      width: "100%",
      padding: "10px 16px",
      gap: 14,
      boxShadow: edited
        ? `inset 3px 0 0 ${T.ink}`
        : `inset 0 -1px 0 ${T.lineSubtle}`,
      background: edited ? T.fill2 : T.surface,
      flexWrap: opts.narrow ? "wrap" : "nowrap",
    },
    col(
      { width: opts.narrow ? 120 : 130, gap: 2 },
      text({ fontSize: s.body, fontWeight: 600, color: T.ink }, day),
      edited
        ? text({ fontSize: s.caption, color: T.muted }, `Was ${was}`)
        : null
    ),
    toggle(true),
    text({ fontSize: s.caption, color: T.muted, width: 40 }, "Open"),
    opts.readOnly
      ? text(
          { fontSize: s.body, color: T.ink, fontWeight: edited ? 600 : 400 },
          hours
        )
      : row(
          { gap: 8 },
          timeBox(s, o, edited),
          text({ color: T.muted, fontSize: s.ui }, "to"),
          timeBox(s, c, edited)
        ),
    spacer(),
    edited
      ? text(
          {
            fontSize: s.caption,
            fontWeight: 600,
            color: T.ink2,
            padding: "2px 8px",
            borderRadius: T.pill,
            background: T.fill,
          },
          "Edited"
        )
      : null
  )
}

function areaTabs(s, current = "Opening hours") {
  const tabs = [
    "Overview",
    "Business profile",
    "Opening hours",
    "Photos",
    "Posts",
    "Food menu",
  ]
  return row(
    {
      gap: 22,
      boxShadow: `inset 0 -1px 0 ${T.line}`,
      width: "100%",
      alignItems: "flex-end",
      height: 38,
    },
    ...tabs.map((t) =>
      col(
        { gap: 9 },
        row(
          { gap: 6 },
          text(
            {
              fontSize: s.ui,
              fontWeight: t === current ? 600 : 500,
              color: t === current ? T.ink : T.ink2,
            },
            t
          ),
          t === current
            ? text(
                {
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#fff",
                  background: T.ink,
                  borderRadius: 9,
                  padding: "1px 6px",
                },
                "2"
              )
            : null
        ),
        h("div", {
          display: "flex",
          height: 2,
          width: "100%",
          background: t === current ? T.ink : "transparent",
        })
      )
    ),
    row(
      { gap: 4, paddingBottom: 11 },
      text({ fontSize: s.ui, fontWeight: 500, color: T.ink2 }, "More"),
      icon("chevron-down", 14, T.ink2)
    )
  )
}

function listingHeader(s, opts = {}) {
  return col(
    { gap: 4 },
    row(
      { gap: 10 },
      text(
        { fontSize: opts.titleSize ?? 26, fontWeight: 700, color: T.ink },
        "Riverside Rooms"
      ),
      icon("chevron-down", 18, T.muted, 2),
      spacer(),
      opts.actions ?? null
    ),
    row(
      { gap: 8 },
      text({ fontSize: s.caption + 1, color: T.muted }, "12 Mill Lane, York"),
      text({ color: T.quaternary, fontSize: s.caption }, "·"),
      statusPill("conflict", s, {
        label: "Hours changed on Google 3 days ago",
        quiet: true,
      })
    )
  )
}

function changesPanel(s) {
  const diff = (label, before, after) =>
    col(
      {
        gap: 4,
        padding: "10px 0",
        boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
      },
      text({ fontSize: s.ui, fontWeight: 600, color: T.ink }, label),
      row(
        { gap: 8 },
        text(
          { fontSize: s.ui, color: T.muted, textDecoration: "line-through" },
          before
        ),
        icon("arrow-right", 14, T.muted),
        text({ fontSize: s.ui, color: T.ink, fontWeight: 600 }, after)
      )
    )
  return card(
    { width: 340, padding: 18, gap: 14, flexShrink: 0 },
    row(
      { gap: 8 },
      text({ fontSize: s.title, fontWeight: 600, color: T.ink }, "Changes"),
      spacer(),
      statusPill("draft", s)
    ),
    text(
      { fontSize: s.caption + 1, color: T.muted, lineHeight: "18px" },
      "Saved here at 10:21. Nothing has gone to Google. Google shows the left-hand values today."
    ),
    col(
      { gap: 0 },
      diff("Friday", "12:00 – 22:00", "12:00 – 23:00"),
      diff("Saturday", "Closed", "10:00 – 23:00")
    ),
    col(
      { gap: 8 },
      text(
        { fontSize: s.caption, fontWeight: 600, color: T.muted },
        "Where these changes are"
      ),
      changeTrack(s, 0, {
        stops: [["Saved here"], ["Approved"], ["Sent"], ["On Google"]],
      })
    ),
    divider(),
    text(
      { fontSize: s.caption, fontWeight: 600, color: T.muted },
      "Recently sent from this listing"
    ),
    col(
      { gap: 10 },
      row(
        { gap: 8 },
        text({ fontSize: s.ui, color: T.ink, flexGrow: 1 }, "Business profile"),
        statusPill("live", s)
      ),
      text(
        { fontSize: s.caption, color: T.muted, marginTop: -6 },
        "Confirmed on Google 2 Nov, 14:20"
      ),
      row(
        { gap: 8 },
        text({ fontSize: s.ui, color: T.ink, flexGrow: 1 }, "Food menu"),
        statusPill("waiting", s)
      ),
      text(
        { fontSize: s.caption, color: T.muted, marginTop: -6 },
        "Sent 09:12. We check again every 2 minutes."
      )
    )
  )
}

function stepRow(s, glyph, color, label, sub, opts = {}) {
  return row(
    {
      gap: 12,
      alignItems: "flex-start",
      padding: "10px 0",
      boxShadow: opts.last ? undefined : `inset 0 -1px 0 ${T.lineSubtle}`,
    },
    icon(glyph, 20, color, 2.25),
    col(
      { gap: 2, flexGrow: 1 },
      text(
        {
          fontSize: s.body,
          fontWeight: 600,
          color: opts.dim ? T.muted : T.ink,
        },
        label
      ),
      sub
        ? text(
            { fontSize: s.caption + 1, color: T.muted, lineHeight: "19px" },
            sub
          )
        : null
    ),
    opts.time ? text({ fontSize: s.caption, color: T.muted }, opts.time) : null
  )
}

export const listing = {
  "listing-desktop": {
    title: "Listing editor · opening hours · desktop 1440 · draft saved",
    width: 1440,
    height: 900,
    build() {
      const s = SIZE.desk
      return row(
        { width: "100%", height: "100%", background: T.canvas },
        sidebar(s, "listings"),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, {
            trail: [
              "Listings",
              "Journey Hospitality",
              "Riverside Rooms",
              "Opening hours",
            ],
          }),
          col(
            {
              flexGrow: 1,
              padding: "22px 32px 0",
              gap: 16,
              overflow: "hidden",
            },
            listingHeader(s, {
              actions: row(
                { gap: 8 },
                button(s, "Check Google now", {
                  kind: "ghost",
                  icon: "refresh-cw",
                  size: "sm",
                }),
                button(s, "Activity", {
                  kind: "secondary",
                  icon: "history",
                  size: "sm",
                })
              ),
            }),
            areaTabs(s),
            row(
              { gap: 24, alignItems: "flex-start", width: "100%", flexGrow: 1 },
              col(
                { flexGrow: 1, gap: 14 },
                row(
                  { gap: 8 },
                  text(
                    { fontSize: s.section, fontWeight: 600, color: T.ink },
                    "Regular hours"
                  ),
                  spacer(),
                  button(s, "Copy Monday to…", {
                    kind: "ghost",
                    size: "sm",
                    icon: "copy",
                  })
                ),
                card({ overflow: "hidden" }, ...DAYS.map((d) => dayRow(s, d))),
                row(
                  { gap: 8, paddingTop: 4 },
                  text(
                    { fontSize: s.section, fontWeight: 600, color: T.ink },
                    "Special hours"
                  ),
                  spacer(),
                  button(s, "Add a special day", {
                    kind: "secondary",
                    size: "sm",
                    icon: "plus",
                  })
                ),
                text(
                  { fontSize: s.body, color: T.muted },
                  "Holidays and one-off closures override the regular week. None planned."
                )
              ),
              changesPanel(s)
            )
          ),
          col(
            { padding: "8px 32px 18px" },
            dispatchBar(s, {
              status: "draft",
              label: "2 changes saved here, not on Google",
              sub: "Publishing sends them to Google and reads them back to confirm.",
              actions: [
                button(s, "Discard", { kind: "onCharcoal" }),
                button(s, "Publish 2 changes", { kind: "send", icon: "send" }),
              ],
            })
          )
        ),
        conceptTag()
      )
    },
  },

  "listing-tablet": {
    title: "Listing publish sheet · tablet 834 · sent, waiting for Google",
    width: 834,
    height: 1194,
    build() {
      const s = SIZE.touch
      return row(
        {
          width: "100%",
          height: "100%",
          background: T.canvas,
          position: "relative",
        },
        rail(s, "listings"),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, {
            back: "Riverside Rooms",
            wide: false,
            scope: scopePill(),
          }),
          col(
            { padding: "20px 24px", gap: 14 },
            listingHeader(s),
            card(
              { overflow: "hidden" },
              ...DAYS.map((d) => dayRow(s, d, { readOnly: true }))
            )
          )
        ),
        // scrim + sheet (from the right edge on a tablet: a panel)
        h("div", {
          display: "flex",
          position: "absolute",
          left: 0,
          top: 0,
          width: 834,
          height: 1194,
          background: T.scrim,
        }),
        col(
          {
            position: "absolute",
            right: 0,
            top: 0,
            width: 540,
            height: 1194,
            background: T.surface,
            boxShadow: T.shadowModal,
            borderRadius: `${T.rModal}px 0 0 ${T.rModal}px`,
          },
          row(
            {
              padding: "18px 20px",
              gap: 10,
              boxShadow: `inset 0 -1px 0 ${T.line}`,
            },
            text(
              { fontSize: 20, fontWeight: 700, color: T.ink, flexGrow: 1 },
              "Publish opening hours"
            ),
            button(s, "", { kind: "ghost", iconOnly: true, icon: "x" })
          ),
          col(
            { padding: "20px", gap: 18, flexGrow: 1 },
            col(
              {
                gap: 10,
                padding: 16,
                borderRadius: T.rCard,
                background: T.infoTint,
              },
              row(
                { gap: 8 },
                icon("hourglass", 20, T.info, 2.25),
                text(
                  { fontSize: 17, fontWeight: 700, color: T.info },
                  "Sent, waiting for Google"
                )
              ),
              text(
                { fontSize: 16, lineHeight: "24px", color: T.ink },
                "Google accepted the change at 10:22 but hasn't shown it yet. It isn't on Google until we read it back. We'll check again at 10:24 and tell you."
              )
            ),
            changeTrack(s, 3, {
              stops: [
                ["Saved here"],
                ["Not needed", "skip"],
                ["Sent"],
                ["On Google"],
              ],
            }),
            col(
              { gap: 0 },
              text(
                {
                  fontSize: 13,
                  fontWeight: 600,
                  color: T.muted,
                  paddingBottom: 4,
                },
                "Steps"
              ),
              stepRow(
                s,
                "circle-check",
                T.ink2,
                "Saved here",
                "Your copy of the hours in NabaPresence.",
                { time: "10:21" }
              ),
              stepRow(
                s,
                "minus",
                T.muted,
                "Approval not needed",
                "Your role can publish without a second person.",
                { dim: true }
              ),
              stepRow(
                s,
                "circle-check",
                T.ink2,
                "Sent to Google",
                "Google accepted the request.",
                { time: "10:22" }
              ),
              stepRow(
                s,
                "hourglass",
                T.info,
                "Waiting for Google to confirm",
                "Reading the hours back from Google. Usually under 10 minutes.",
                { time: "now" }
              ),
              stepRow(
                s,
                "circle",
                T.quaternary,
                "On Google",
                "Shown once Google returns the new hours.",
                { dim: true, last: true }
              )
            ),
            col(
              { gap: 6 },
              text(
                { fontSize: 13, fontWeight: 600, color: T.muted },
                "What was sent"
              ),
              row(
                { gap: 8 },
                text({ fontSize: 15, color: T.ink, width: 90 }, "Friday"),
                text(
                  {
                    fontSize: 15,
                    color: T.muted,
                    textDecoration: "line-through",
                  },
                  "12:00 – 22:00"
                ),
                icon("arrow-right", 14, T.muted),
                text(
                  { fontSize: 15, fontWeight: 600, color: T.ink },
                  "12:00 – 23:00"
                )
              ),
              row(
                { gap: 8 },
                text({ fontSize: 15, color: T.ink, width: 90 }, "Saturday"),
                text(
                  {
                    fontSize: 15,
                    color: T.muted,
                    textDecoration: "line-through",
                  },
                  "Closed"
                ),
                icon("arrow-right", 14, T.muted),
                text(
                  { fontSize: 15, fontWeight: 600, color: T.ink },
                  "10:00 – 23:00"
                )
              )
            )
          ),
          row(
            {
              padding: "14px 20px 24px",
              gap: 10,
              boxShadow: `inset 0 1px 0 ${T.line}`,
              background: T.sunken,
            },
            text(
              { fontSize: 15, color: T.ink2, flexGrow: 1, lineHeight: "20px" },
              "You can close this. The listing keeps checking."
            ),
            button(s, "Close", { kind: "primary" })
          )
        ),
        conceptTag("Concept · sample data", { left: 84, bottom: 16 })
      )
    },
  },

  "listing-phone": {
    title: "Listing editor · phone 390 · awaiting approval",
    width: 390,
    height: 844,
    build() {
      const s = SIZE.touch
      return col(
        { width: "100%", height: "100%", background: T.canvas },
        appbar(s, {
          back: "Riverside Rooms",
          actions: ["history", "ellipsis"],
        }),
        col(
          { flexGrow: 1, padding: "14px 16px 0", gap: 12, overflow: "hidden" },
          text(
            { fontSize: 26, fontWeight: 700, color: T.ink },
            "Opening hours"
          ),
          col(
            {
              gap: 8,
              padding: 14,
              borderRadius: T.rCard,
              background: T.warningTint,
              border: `1px solid ${T.warningSolid}`,
            },
            row(
              { gap: 8 },
              icon("user-check", 18, T.warning, 2.25),
              text(
                { fontSize: 16, fontWeight: 700, color: T.warning },
                "Awaiting approval"
              )
            ),
            text(
              { fontSize: 15, lineHeight: "21px", color: T.ink },
              "You asked at 10:21. Priya or Sam can approve. Nothing has gone to Google, and the hours are locked until they decide."
            )
          ),
          card(
            { overflow: "hidden" },
            ...DAYS.slice(3).map(([d, h1, was]) =>
              row(
                {
                  padding: "12px 14px",
                  gap: 10,
                  boxShadow: was
                    ? `inset 3px 0 0 ${T.ink}`
                    : `inset 0 -1px 0 ${T.lineSubtle}`,
                  background: was ? T.fill2 : T.surface,
                  alignItems: "flex-start",
                },
                col(
                  { flexGrow: 1, gap: 2 },
                  text({ fontSize: 16, fontWeight: 600, color: T.ink }, d),
                  was
                    ? text({ fontSize: 13, color: T.muted }, `Was ${was}`)
                    : null
                ),
                text(
                  { fontSize: 16, color: T.ink, fontWeight: was ? 600 : 400 },
                  h1
                )
              )
            )
          ),
          text(
            { fontSize: 13, color: T.muted },
            "Monday to Wednesday unchanged · 12:00 – 22:00"
          )
        ),
        dispatchBar(s, {
          docked: true,
          status: "approval",
          label: "Awaiting approval",
          sub: "2 changes · sent for approval 10:21",
          actions: [button(s, "Withdraw", { kind: "onCharcoal" })],
        }),
        homeIndicatorDark(),
        conceptTag("Concept · sample data", { left: 112, top: 14 })
      )
    },
  },
}
