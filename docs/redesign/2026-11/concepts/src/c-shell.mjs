// Track position per state, exactly as DIRECTION §6.1 "Track" column:
// index = current stop (4 = every stop done, On Google reached).
const TRACK = {
  draft: 0,
  blocked: 1,
  approval: 1,
  changes: 0,
  approved: 2,
  sending: 2,
  retrying: 2,
  waiting: 3,
  live: 4,
  uncertain: 2,
  rejected: 2,
  failed: 2,
}

// Shell concept: navigation, scope indicator + switcher, search, notifications,
// account, at three sizes; plus the lifecycle board (status vocabulary).
import {
  SIZE,
  T,
  avatar,
  button,
  card,
  changeTrack,
  col,
  conceptTag,
  dispatchBar,
  divider,
  h,
  icon,
  row,
  spacer,
  statusPill,
  text,
} from "./kit.mjs"
import {
  appbar,
  homeIndicator,
  rail,
  scopePill,
  sidebar,
  tabbar,
  topbar,
} from "./shell.mjs"

const CLIENTS = [
  ["All clients", "31 listings", null, "A"],
  [
    "Journey Hospitality",
    "9 listings · 1 needs attention",
    "attention",
    "J",
    true,
  ],
  ["Harbour Collective", "6 listings · in sync", "ok", "H"],
  ["Moor & Coast Inns", "12 listings · 1 failed send", "bad", "M"],
  ["Riverside Group", "4 listings · in sync", "ok", "R"],
]
const dotColour = (t) =>
  t === "attention"
    ? T.warningSolid
    : t === "bad"
      ? T.dangerSolid
      : T.quaternary

function clientRow(s, [name, sub, tone, init, current], opts = {}) {
  return row(
    {
      height: opts.tall ? 56 : 46,
      padding: "0 10px",
      gap: 10,
      borderRadius: T.rControl,
      background: current ? T.fill : "transparent",
    },
    text(
      {
        width: 28,
        height: 28,
        borderRadius: 6,
        background: init === "A" ? T.fill : "#3F5E52",
        color: init === "A" ? T.ink2 : "#fff",
        fontSize: 13,
        fontWeight: 700,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
      },
      init === "A" ? "∗" : init
    ),
    col(
      { flexGrow: 1, gap: 1 },
      text({ fontSize: s.ui, fontWeight: 600, color: T.ink }, name),
      row(
        { gap: 5 },
        tone
          ? h("div", {
              display: "flex",
              width: 7,
              height: 7,
              borderRadius: 9,
              background: dotColour(tone),
            })
          : null,
        text({ fontSize: s.caption, color: T.muted }, sub)
      )
    ),
    current ? icon("check", 16, T.ink, 2.5) : null,
    opts.chevron && init !== "A" ? icon("chevron-right", 16, T.muted) : null
  )
}

function notifications() {
  const n = (ic, color, title, sub, when, unread) =>
    row(
      {
        gap: 12,
        padding: "12px 16px",
        alignItems: "flex-start",
        boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
      },
      icon(ic, 18, color, 2),
      col(
        { flexGrow: 1, gap: 3 },
        text(
          {
            fontSize: 15,
            fontWeight: unread ? 600 : 500,
            color: T.ink,
            lineHeight: "20px",
          },
          title
        ),
        text({ fontSize: 13, color: T.muted, lineHeight: "18px" }, sub)
      ),
      col(
        { gap: 6, alignItems: "flex-end" },
        text({ fontSize: 13, color: T.muted }, when),
        unread
          ? h("div", {
              display: "flex",
              width: 8,
              height: 8,
              borderRadius: 9,
              background: T.infoSolid,
            })
          : null
      )
    )
  return col(
    {},
    n(
      "triangle-alert",
      T.danger,
      "A reply to Raj Patel wasn't sent",
      "Harbour Kitchen · Google timed out. Nothing changed on Google.",
      "09:12",
      true
    ),
    n(
      "user-check",
      T.warning,
      "Sam asked you to approve a reply",
      "Riverside Rooms · Megan Price, 2 stars",
      "10:04",
      true
    ),
    n(
      "unlink",
      T.danger,
      "Google stopped accepting ops@moorcoast.example",
      "Moor & Coast Inns · 12 listings paused until reconnected",
      "Yesterday",
      true
    ),
    n(
      "badge-check",
      T.success,
      "Opening hours are on Google",
      "Riverside Rooms · confirmed by reading them back",
      "Yesterday"
    ),
    n(
      "git-compare",
      T.warning,
      "Google changed the phone number",
      "The Bell · decide whether to keep it",
      "2 Nov"
    )
  )
}

export const shell = {
  "shell-desktop": {
    title: "Shell · desktop 1440 · scope switcher open",
    width: 1440,
    height: 900,
    build() {
      const s = SIZE.desk
      return row(
        {
          width: "100%",
          height: "100%",
          background: T.canvas,
          position: "relative",
        },
        sidebar(s, "inbox", { scopeOpen: true }),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, { trail: ["Inbox"] }),
          col(
            { padding: 32, gap: 12 },
            text({ fontSize: 26, fontWeight: 700, color: T.ink }, "Inbox")
          )
        ),
        // Scope popover, anchored under the scope button.
        col(
          {
            position: "absolute",
            left: 12,
            top: 140,
            width: 320,
            padding: 6,
            gap: 2,
            background: T.surface,
            border: `1px solid ${T.line}`,
            borderRadius: T.rMenu,
            boxShadow: T.shadowPop,
          },
          row(
            {
              height: 36,
              padding: "0 10px",
              gap: 8,
              borderRadius: T.rControl,
              border: `1px solid ${T.line}`,
              margin: "4px 4px 6px",
            },
            icon("search", 15, T.muted),
            text({ fontSize: 13, color: T.muted }, "Find a client")
          ),
          ...CLIENTS.map((c) => clientRow(s, c)),
          divider({ margin: "6px 0" }),
          row(
            { height: 36, padding: "0 10px", gap: 10 },
            icon("plus", 16, T.ink2),
            text({ fontSize: 13, fontWeight: 500, color: T.ink }, "New client")
          ),
          row(
            { height: 36, padding: "0 10px", gap: 10 },
            icon("building-2", 16, T.ink2),
            text(
              { fontSize: 13, fontWeight: 500, color: T.ink },
              "All clients page"
            )
          )
        ),
        // Account menu hint and the command palette entry are visible in the chrome.
        col(
          {
            position: "absolute",
            left: 360,
            top: 170,
            width: 440,
            gap: 10,
            padding: 16,
            borderRadius: T.rCard,
            background: T.surface,
            border: `1px dashed ${T.lineStrong}`,
          },
          text(
            { fontSize: 13, fontWeight: 600, color: T.muted },
            "Design notes"
          ),
          ...[
            [
              "1",
              "Scope lives once, at the top of the nav: name, health dot, listing count.",
            ],
            [
              "2",
              "Choosing applies to Inbox, Listings and Reports at once; page filters only narrow it.",
            ],
            [
              "3",
              "Outbox: everything on its way to Google; the count is failures.",
            ],
            [
              "4",
              "Search (⌘K) and notifications sit in the top bar; the account sits at the foot of the nav.",
            ],
          ].map(([n, t]) =>
            row(
              { gap: 8, alignItems: "flex-start" },
              text(
                {
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  background: T.info,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  justifyContent: "center",
                  alignItems: "center",
                  flexShrink: 0,
                },
                n
              ),
              text({ fontSize: 13, color: T.ink2, lineHeight: "19px" }, t)
            )
          )
        ),
        conceptTag()
      )
    },
  },

  "shell-tablet": {
    title: "Shell · tablet 834 · notifications panel",
    width: 834,
    height: 1194,
    build() {
      const s = SIZE.touch
      const scopeBtn = scopePill()
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
          topbar(s, { scope: scopeBtn, trail: [], wide: false }),
          col(
            { padding: 24, gap: 8 },
            text({ fontSize: 26, fontWeight: 700, color: T.ink }, "Listings")
          )
        ),
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
            width: 460,
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
              "Notifications"
            ),
            button(s, "Mark all read", { kind: "ghost", size: "sm" }),
            button(s, "", { kind: "ghost", iconOnly: true, icon: "x" })
          ),
          row(
            { gap: 8, padding: "12px 16px 4px" },
            ...["Unread 3", "All", "Failures"].map((c, i) =>
              text(
                {
                  height: 30,
                  padding: "0 12px",
                  alignItems: "center",
                  borderRadius: T.pill,
                  background: i === 0 ? T.ink : T.surface,
                  border: `1px solid ${i === 0 ? T.ink : T.line}`,
                  color: i === 0 ? "#fff" : T.ink,
                  fontSize: 14,
                  fontWeight: 500,
                },
                c
              )
            )
          ),
          notifications()
        ),
        conceptTag("Concept · sample data", { left: 84, top: 64 })
      )
    },
  },

  "shell-phone-scope": {
    title: "Shell · phone 390 · scope sheet",
    width: 390,
    height: 844,
    build() {
      const s = SIZE.touch
      return col(
        {
          width: "100%",
          height: "100%",
          background: T.canvas,
          position: "relative",
        },
        appbar(s, {}),
        col(
          { padding: 16, gap: 8 },
          text({ fontSize: 26, fontWeight: 700, color: T.ink }, "Inbox")
        ),
        spacer(),
        tabbar(s, "inbox"),
        h("div", {
          display: "flex",
          position: "absolute",
          left: 0,
          top: 0,
          width: 390,
          height: 844,
          background: T.scrim,
        }),
        col(
          {
            position: "absolute",
            left: 8,
            right: 8,
            bottom: 8,
            padding: "0 8px 8px",
            background: T.surface,
            borderRadius: 24,
            boxShadow: T.shadowModal,
          },
          row(
            { height: 20, justifyContent: "center" },
            h("div", {
              display: "flex",
              width: 36,
              height: 5,
              borderRadius: 3,
              background: T.lineStrong,
            })
          ),
          row(
            { padding: "2px 8px 4px", gap: 8 },
            text(
              { fontSize: 18, fontWeight: 700, color: T.ink, flexGrow: 1 },
              "Working on"
            ),
            button(s, "", { kind: "ghost", iconOnly: true, icon: "x" })
          ),
          text(
            {
              fontSize: 14,
              color: T.muted,
              padding: "0 8px 10px",
              lineHeight: "20px",
            },
            "Inbox, Listings and Reports show this client. Open a client to pick one listing."
          ),
          ...CLIENTS.map((c) => clientRow(s, c, { tall: true, chevron: true })),
          row({ height: 34 })
        ),
        conceptTag("Concept · sample data", { left: 112, top: 14 })
      )
    },
  },

  "shell-phone-more": {
    title: "Shell · phone 390 · More sheet",
    width: 390,
    height: 844,
    build() {
      const s = SIZE.touch
      const r = (ic, label, trailing, color = T.ink2) =>
        row(
          { height: 48, padding: "0 12px", gap: 12 },
          icon(ic, 20, color),
          text({ fontSize: 16, color: T.ink, flexGrow: 1 }, label),
          trailing ?? null
        )
      return col(
        {
          width: "100%",
          height: "100%",
          background: T.canvas,
          position: "relative",
        },
        appbar(s, {}),
        spacer(),
        tabbar(s, "more"),
        h("div", {
          display: "flex",
          position: "absolute",
          left: 0,
          top: 0,
          width: 390,
          height: 844,
          background: T.scrim,
        }),
        col(
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "0 8px",
            background: T.surface,
            borderRadius: `${T.rSheet}px ${T.rSheet}px 0 0`,
            boxShadow: T.shadowModal,
          },
          row(
            { height: 20, justifyContent: "center" },
            h("div", {
              display: "flex",
              width: 36,
              height: 5,
              borderRadius: 3,
              background: T.lineStrong,
            })
          ),
          row(
            { padding: "2px 12px 8px" },
            text(
              { fontSize: 18, fontWeight: 700, color: T.ink, flexGrow: 1 },
              "More"
            ),
            button(s, "", { kind: "ghost", iconOnly: true, icon: "x" })
          ),
          row(
            {
              height: 44,
              margin: "0 8px 12px",
              padding: "0 12px",
              gap: 8,
              borderRadius: T.pill,
              background: T.fill2,
            },
            icon("search", 18, T.muted),
            text(
              { fontSize: 16, color: T.muted },
              "Search reviews, listings, clients"
            )
          ),
          r(
            "send",
            "Outbox",
            row(
              { gap: 4 },
              icon("triangle-alert", 14, T.danger, 2.25),
              text(
                { fontSize: 14, color: T.danger, fontWeight: 600 },
                "1 failed"
              )
            )
          ),
          r("calendar-days", "Calendar"),
          r(
            "bell",
            "Notifications",
            text({ fontSize: 14, color: T.muted, fontWeight: 600 }, "3")
          ),
          r("users", "Team"),
          r("settings", "Settings"),
          divider({ margin: "10px 0" }),
          row(
            { gap: 12, padding: "8px 12px" },
            avatar("AS", 40),
            col(
              { flexGrow: 1, gap: 2 },
              text(
                { fontSize: 16, fontWeight: 600, color: T.ink },
                "Asha Shrestha"
              ),
              text({ fontSize: 13, color: T.muted }, "Owner · Northgate Agency")
            ),
            icon("chevron-right", 18, T.muted)
          ),
          row(
            {
              margin: "6px 12px",
              padding: 3,
              borderRadius: T.rControl + 2,
              background: T.fill,
              gap: 2,
            },
            ...["Light", "Dark", "System"].map((r2, i) =>
              text(
                {
                  flexGrow: 1,
                  height: 36,
                  justifyContent: "center",
                  alignItems: "center",
                  borderRadius: T.rControl,
                  background: i === 2 ? T.surface : "transparent",
                  fontSize: 15,
                  fontWeight: i === 2 ? 600 : 500,
                  color: i === 2 ? T.ink : T.ink2,
                },
                r2
              )
            )
          ),
          r("log-out", "Sign out", null, T.danger),
          homeIndicator()
        ),
        conceptTag("Concept · sample data", { left: 112, top: 14 })
      )
    },
  },

  "lifecycle-board": {
    title:
      "Status vocabulary: pills, track and dispatch bar for every lifecycle state",
    width: 1440,
    height: 1050,
    build() {
      const s = SIZE.desk
      const rows = [
        [
          "unsaved",
          "Edits only in this browser tab",
          "useEditorDraft dirty (sessionStorage stash)",
          null,
        ],
        [
          "draft",
          "Saved in NabaPresence, nothing sent",
          "outcome saved_locally · profile core_dirty · post draft · reply drafted",
          0,
        ],
        [
          "blocked",
          "Checks failed, publishing is blocked",
          "verification verdict fail",
          0,
        ],
        [
          "approval",
          "A person must approve before sending",
          "outcome awaiting_approval · workflow awaiting_approval · post awaiting_approval",
          1,
        ],
        [
          "changes",
          "Approver sent it back to the author",
          "approval_decision rejected → drafted; listing change failed + approval_rejected",
          0,
        ],
        [
          "approved",
          "Approved; the author still has to send",
          "listing change approved, publish unlocked",
          1,
        ],
        [
          "sending",
          "Request is on its way",
          "workflow publish_requested · attempt started/publishing · post publishing · bulk running",
          2,
        ],
        [
          "retrying",
          "Google throttled us; automatic retry",
          "publish_attempt retryable (retryScheduledAt)",
          2,
        ],
        [
          "waiting",
          "Google accepted, not yet read back",
          "outcome sent/awaiting_confirmation · reply PENDING/accepted · post PROCESSING · bulk succeeded+unrecorded",
          2,
        ],
        [
          "live",
          "Confirmed on Google by readback or Google state",
          "outcome confirmed_applied · reply published+APPROVED · post LIVE · bulk succeeded+confirmed",
          3,
        ],
        [
          "uncertain",
          "We can't tell if Google applied it",
          "outcome uncertain · attempt ambiguous",
          2,
        ],
        [
          "rejected",
          "Google refused it; nothing changed",
          "outcome rejected · reply REJECTED · post google_post_rejected",
          2,
        ],
        [
          "failed",
          "It didn't go through; saved copy kept",
          "outcome failed · workflow failed · attempt failed",
          2,
        ],
        [
          "conflict",
          "Google changed it since we saved",
          "sync google_dirty / conflict · *_stale codes",
          null,
        ],
        [
          "withdrawn",
          "Ended without sending (also Expired, not sent · Replaced)",
          "listing change failed + approval_withdrawn / superseded / invalidated · bulk cancelled/expired",
          null,
        ],
      ]
      return col(
        {
          width: "100%",
          height: "100%",
          background: T.canvas,
          padding: "28px 36px",
          gap: 14,
        },
        row(
          { gap: 12 },
          text(
            { fontSize: 26, fontWeight: 700, color: T.ink },
            "Where is it? One vocabulary for every change"
          ),
          spacer(),
          text(
            { fontSize: 13, color: T.muted },
            "Tone = who acts next: neutral nobody · amber a person · blue Google/system · green confirmed · red broken"
          )
        ),
        card(
          { overflow: "hidden" },
          row(
            {
              padding: "0 18px",
              height: 36,
              boxShadow: `inset 0 -1px 0 ${T.line}`,
            },
            text(
              { width: 260, fontSize: 13, color: T.muted, fontWeight: 500 },
              "Label (pill)"
            ),
            text(
              { width: 330, fontSize: 13, color: T.muted, fontWeight: 500 },
              "Means"
            ),
            text(
              { width: 330, fontSize: 13, color: T.muted, fontWeight: 500 },
              "Change track"
            ),
            text(
              { flexGrow: 1, fontSize: 13, color: T.muted, fontWeight: 500 },
              "Backend source (see DIRECTION.md §6)"
            )
          ),
          ...rows.map(([k, means, src, stop]) =>
            row(
              {
                padding: "0 18px",
                height: 52,
                boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
              },
              row({ width: 260 }, statusPill(k, s)),
              text(
                { width: 330, fontSize: 14, color: T.ink, paddingRight: 16 },
                means
              ),
              row(
                { width: 330, paddingRight: 24 },
                stop === null
                  ? text({ fontSize: 12, color: T.muted }, "not a Google step")
                  : changeTrack(s, TRACK[k] ?? stop, {
                      compact: true,
                      failedAt: ["failed", "rejected", "blocked"].includes(k)
                        ? (TRACK[k] ?? stop)
                        : -1,
                    })
              ),
              text(
                {
                  flexGrow: 1,
                  fontSize: 12,
                  color: T.muted,
                  lineHeight: "16px",
                },
                src
              )
            )
          )
        ),
        row(
          { gap: 16, alignItems: "flex-start" },
          col(
            { flexGrow: 1, gap: 10 },
            text(
              { fontSize: 13, fontWeight: 600, color: T.muted },
              "Dispatch bar: confirmed"
            ),
            dispatchBar(s, {
              status: "live",
              label: "On Google",
              sub: "Confirmed 10:24 by reading the hours back from Google.",
              actions: [
                button(s, "View on Google", {
                  kind: "onCharcoal",
                  icon: "external-link",
                }),
              ],
            })
          ),
          col(
            { flexGrow: 1, gap: 10 },
            text(
              { fontSize: 13, fontWeight: 600, color: T.muted },
              "Dispatch bar: not confirmed"
            ),
            dispatchBar(s, {
              status: "uncertain",
              label: "Not confirmed: check Google",
              sub: "Google's answer was lost. Retrying reads Google first.",
              actions: [
                button(s, "Check Google", {
                  kind: "onCharcoal",
                  icon: "refresh-cw",
                }),
              ],
            })
          )
        ),
        conceptTag("Concept · vocabulary board", { right: 36, bottom: 24 })
      )
    },
  },
}
