// Concept 1: Inbox + review detail. AI draft, verification, approval, publish.
import {
  SIZE,
  T,
  avatar,
  button,
  changeTrack,
  chip,
  col,
  conceptTag,
  dispatchBar,
  divider,
  h,
  homeIndicatorDark,
  icon,
  row,
  spacer,
  stars,
  statusPill,
  text,
} from "./kit.mjs"
import { appbar, rail, sidebar, tabbar, scopePill, topbar } from "./shell.mjs"

const REVIEWS = [
  {
    who: "Megan Price",
    init: "MP",
    n: 2,
    when: "12 min",
    loc: "Riverside Rooms",
    body: "Waited 40 minutes for mains and nobody came to explain. The food was good once it arrived but the evening was spoilt.",
    st: "needsReply",
    unread: true,
  },
  {
    who: "Tom Okafor",
    init: "TO",
    n: 5,
    when: "1 h",
    loc: "The Bell",
    body: "Lovely Sunday roast, friendly staff, dog welcome. Will be back.",
    st: "approval",
  },
  {
    who: "Lena Fischer",
    init: "LF",
    n: 4,
    when: "3 h",
    loc: "Riverside Rooms",
    body: "Great view over the river. Breakfast a bit slow but very kind team.",
    st: "waiting",
  },
  {
    who: "Raj Patel",
    init: "RP",
    n: 1,
    when: "Yesterday",
    loc: "Harbour Kitchen",
    body: "Booking was lost and we were turned away at the door.",
    st: "failed",
  },
  {
    who: "Chloe Martin",
    init: "CM",
    n: 5,
    when: "Yesterday",
    loc: "The Bell",
    body: "Best fish and chips in town.",
    st: "live",
  },
  {
    who: "Daniel Evans",
    init: "DE",
    n: 3,
    when: "2 days",
    loc: "Riverside Rooms",
    body: "Fine, nothing special. Parking is tricky.",
    st: "draft",
  },
]

// The approval queue as the approver sees it: every row awaits approval.
const APPROVAL_QUEUE = [REVIEWS[0], REVIEWS[1], REVIEWS[5]].map((r) => ({
  ...r,
  st: "approval",
  unread: false,
}))

function queueTabs(s, opts = {}) {
  const active = opts.active ?? "Needs reply"
  const tabs = [
    ["Needs reply", 12],
    ["Approval", 3],
    ["Sending", 1],
    ["Failed", 1, false, true],
    ["Done"],
    ["All"],
  ].map(([l, c, , bad]) => [l, c, l === active, bad])
  return row(
    {
      gap: opts.tight ? 14 : 15,
      height: opts.tight ? 40 : 38,
      boxShadow: `inset 0 -1px 0 ${T.line}`,
      width: "100%",
      alignItems: "flex-end",
    },
    ...tabs.map(([label, count, on, bad]) =>
      col(
        { gap: 8 },
        row(
          { gap: 6, height: 22 },
          text(
            {
              fontSize: s.ui,
              fontWeight: on ? 600 : 500,
              color: on ? T.ink : T.ink2,
            },
            label
          ),
          count != null
            ? bad
              ? row(
                  { gap: 3 },
                  icon("triangle-alert", 12, T.danger, 2.25),
                  text(
                    { fontSize: s.caption, color: T.danger, fontWeight: 600 },
                    String(count)
                  )
                )
              : text(
                  { fontSize: s.caption, color: T.muted, fontWeight: 500 },
                  String(count)
                )
            : null
        ),
        h("div", {
          display: "flex",
          height: 2,
          background: on ? T.ink : "transparent",
          width: "100%",
        })
      )
    )
  )
}

function reviewRow(s, r, opts = {}) {
  const selected = opts.selected
  return row(
    {
      gap: 12,
      padding: `${s === SIZE.desk ? 10 : 12}px 16px`,
      alignItems: "flex-start",
      background: selected ? T.fill : "transparent",
      boxShadow: selected
        ? `inset 3px 0 0 ${T.ink}`
        : `inset 0 -1px 0 ${T.lineSubtle}`,
      width: "100%",
    },
    avatar(r.init, s === SIZE.desk ? 32 : 36),
    col(
      { flexGrow: 1, gap: 3, minWidth: 0 },
      row(
        { gap: 6, width: "100%" },
        text(
          { fontSize: s.ui, fontWeight: r.unread ? 700 : 600, color: T.ink },
          r.who
        ),
        r.unread
          ? h("div", {
              display: "flex",
              width: 7,
              height: 7,
              borderRadius: 9,
              background: T.infoSolid,
            })
          : null,
        spacer(),
        text({ fontSize: s.caption, color: T.muted }, r.when)
      ),
      row(
        { gap: 6 },
        stars(r.n, 12),
        text({ fontSize: s.caption, color: T.muted }, r.loc)
      ),
      text(
        {
          fontSize: s.caption + 1,
          color: T.ink2,
          lineHeight: `${s.captionLh + 1}px`,
          maxHeight: (s.captionLh + 1) * (opts.lines ?? 1),
          overflow: "hidden",
        },
        r.body
      ),
      r.st === "needsReply" ? null : row({ paddingTop: 3 }, statusPill(r.st, s))
    )
  )
}

function verification(s, kind) {
  if (kind === "pass")
    return col(
      {
        gap: 8,
        padding: 14,
        borderRadius: T.rCard,
        background: T.surface,
        border: `1px solid ${T.line}`,
      },
      row(
        { gap: 8 },
        icon("shield-check", 18, T.ink2, 2),
        text(
          { fontSize: s.ui, fontWeight: 600, color: T.ink },
          "Checks passed"
        ),
        spacer(),
        text(
          { fontSize: s.caption, color: T.muted },
          "Checked 10:04 · this version"
        )
      ),
      row(
        { gap: 18, flexWrap: "wrap" },
        ...[
          "No personal details",
          "Matches reply policy",
          "Within Google's length limit",
          "No banned phrases",
        ].map((c) =>
          row(
            { gap: 5 },
            icon("check", 14, T.ink2, 2.5),
            text({ fontSize: s.caption + 1, color: T.ink2 }, c)
          )
        )
      )
    )
  return col(
    {
      gap: 8,
      padding: 14,
      borderRadius: T.rCard,
      background: T.dangerTint,
      border: `1px solid ${T.dangerSolid}`,
    },
    row(
      { gap: 8 },
      icon("octagon-x", 18, T.danger, 2),
      text(
        { fontSize: s.ui, fontWeight: 700, color: T.danger },
        "Blocked by checks"
      )
    ),
    text(
      { fontSize: s.body, color: T.ink, lineHeight: `${s.bodyLh}px` },
      "The reply includes a phone number (07700 900123). Google replies are public, so remove it or use the venue's main number."
    ),
    row(
      { gap: 8, paddingTop: 2 },
      button(s, "Edit reply", {
        kind: "secondary",
        size: "sm",
        icon: "pencil",
      }),
      button(s, "Check again", {
        kind: "ghost",
        size: "sm",
        icon: "refresh-cw",
      })
    )
  )
}

function draftBlock(s, opts = {}) {
  return col(
    {
      gap: 10,
      padding: 16,
      borderRadius: T.rCard,
      background: T.surface,
      border: `1px solid ${T.line}`,
    },
    row(
      { gap: 8, width: "100%" },
      text({ fontSize: s.ui, fontWeight: 600, color: T.ink }, "Your reply"),
      row(
        {
          gap: 4,
          padding: "2px 8px",
          borderRadius: T.pill,
          background: T.fill2,
        },
        icon("sparkles", 13, T.ink2, 2),
        text(
          { fontSize: s.caption, color: T.ink2, fontWeight: 500 },
          "Written with AI · Warm"
        )
      ),
      spacer(),
      opts.locked
        ? text(
            { fontSize: s.caption, color: T.muted },
            opts.lockLabel ?? "Locked while awaiting approval"
          )
        : button(s, "Regenerate", {
            kind: "ghost",
            size: "sm",
            icon: "refresh-cw",
          })
    ),
    text(
      { fontSize: s.reading, lineHeight: `${s.readingLh}px`, color: T.ink },
      opts.text ??
        "Hi Megan, thank you for telling us, and I'm sorry the wait spoilt your evening. Forty minutes is too long and we should have come to explain. I've shared this with the kitchen team, and we'd love the chance to put it right. Simon, General Manager"
    ),
    row(
      { gap: 10 },
      text(
        { fontSize: s.caption, color: T.muted },
        opts.meta ?? "262 of 4,096 bytes · Saved here 10:03"
      )
    )
  )
}

function detail(s, opts = {}) {
  const r = REVIEWS[0]
  return col(
    { flexGrow: 1, height: "100%", background: T.surface, minWidth: 0 },
    col(
      {
        flexGrow: 1,
        padding: opts.pad ?? "20px 28px",
        gap: 18,
        overflow: "hidden",
      },
      row(
        { gap: 12, alignItems: "flex-start", width: "100%" },
        avatar(r.init, 40),
        col(
          { gap: 3, flexGrow: 1 },
          text({ fontSize: s.title, fontWeight: 600, color: T.ink }, r.who),
          row(
            { gap: 8 },
            stars(r.n, 14),
            text(
              { fontSize: s.caption, color: T.muted },
              "12 minutes ago · Google review"
            )
          ),
          text(
            { fontSize: s.caption, color: T.muted },
            "Riverside Rooms · Journey Hospitality"
          )
        ),
        button(s, "", {
          kind: "ghost",
          iconOnly: true,
          icon: "ellipsis",
          size: "sm",
        })
      ),
      text(
        {
          fontSize: s.reading,
          lineHeight: `${s.readingLh}px`,
          color: T.ink,
          maxWidth: 680,
        },
        r.body
      ),
      divider(),
      opts.track
        ? col(
            { gap: 8 },
            text(
              { fontSize: s.caption, fontWeight: 600, color: T.muted },
              "Where this reply is"
            ),
            opts.track
          )
        : null,
      draftBlock(s, opts.draft ?? {}),
      verification(s, opts.verify ?? "pass")
    ),
    col({ padding: opts.barPad ?? "0 20px 16px" }, opts.bar)
  )
}

const deskApprovalBar = (s) =>
  dispatchBar(s, {
    status: "approval",
    label: "Waiting for your approval",
    sub: "Sam asked at 10:04. Approving publishes it to Google straight away.",
    actions: [
      button(s, "Send back", { kind: "onCharcoal" }),
      button(s, "Approve and publish", { kind: "send", icon: "send" }),
    ],
  })

export const inbox = {
  "inbox-desktop": {
    title: "Inbox · desktop 1440 · approver view",
    width: 1440,
    height: 900,
    build() {
      const s = SIZE.desk
      return row(
        { width: "100%", height: "100%", background: T.canvas },
        sidebar(s, "inbox"),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, { trail: ["Inbox"], bell: 3 }),
          row(
            { flexGrow: 1, minHeight: 0 },
            col(
              {
                width: 420,
                height: "100%",
                boxShadow: `inset -1px 0 0 ${T.line}`,
                background: T.canvas,
              },
              col(
                { padding: "18px 16px 0", gap: 12 },
                row(
                  { gap: 8 },
                  text(
                    { fontSize: 22, fontWeight: 700, color: T.ink },
                    "Inbox"
                  ),
                  text({ fontSize: 22, color: T.muted }, "17"),
                  spacer(),
                  button(s, "", {
                    kind: "ghost",
                    iconOnly: true,
                    icon: "refresh-cw",
                    size: "sm",
                  })
                ),
                queueTabs(s, { active: "Approval" }),
                row(
                  { gap: 8 },
                  row(
                    {
                      flexGrow: 1,
                      height: 32,
                      padding: "0 10px",
                      gap: 8,
                      borderRadius: T.rControl,
                      border: `1px solid ${T.line}`,
                      background: T.surface,
                    },
                    icon("search", 15, T.muted),
                    text({ fontSize: s.ui, color: T.muted }, "Search reviews")
                  ),
                  chip(s, "Filters", { icon: "list-filter" })
                ),
                row(
                  { gap: 6 },
                  chip(s, "1–2 stars", { on: true }),
                  chip(s, "With text"),
                  chip(s, "Riverside Rooms")
                )
              ),
              col(
                { paddingTop: 10 },
                ...APPROVAL_QUEUE.map((r, i) =>
                  reviewRow(s, r, { selected: i === 0 })
                )
              )
            ),
            detail(s, {
              track: changeTrack(s, 1),
              draft: { locked: true },
              bar: deskApprovalBar(s),
            })
          )
        ),
        conceptTag()
      )
    },
  },

  "inbox-tablet": {
    title: "Inbox review detail · tablet 834 · verification failed",
    width: 834,
    height: 1194,
    build() {
      const s = SIZE.touch
      return row(
        { width: "100%", height: "100%", background: T.canvas },
        rail(s, "inbox"),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, {
            back: "Inbox",
            wide: false,
            scope: scopePill(),
            bell: 3,
          }),
          detail(s, {
            pad: "20px 24px",
            track: changeTrack(s, 1, {
              failedAt: 1,
              failedLabel: "Blocked by checks",
            }),
            verify: "fail",
            draft: {
              text: "Hi Megan, I'm so sorry about the wait. Please call me directly on 07700 900123 and I'll sort out a free dinner for two. Simon",
              meta: "121 of 4,096 bytes · Saved here 10:06",
            },
            barPad: "0 16px 20px",
            bar: dispatchBar(s, {
              status: "blocked",
              label: "Blocked: fix the reply to publish",
              sub: "Failed checks stop publishing. Your draft is saved here.",
              actions: [
                button(s, "Publish reply", {
                  kind: "disabledOnCharcoal",
                  icon: "send",
                }),
              ],
            }),
          })
        ),
        conceptTag()
      )
    },
  },

  "inbox-phone-list": {
    title: "Inbox list · phone 390",
    width: 390,
    height: 844,
    build() {
      const s = SIZE.touch
      return col(
        { width: "100%", height: "100%", background: T.canvas },
        appbar(s, {}),
        col(
          { padding: "12px 16px 0", gap: 10 },
          row(
            { gap: 8 },
            text({ fontSize: 26, fontWeight: 700, color: T.ink }, "Inbox"),
            text({ fontSize: 26, color: T.muted }, "17")
          ),
          queueTabs(s, { tight: true, active: "All" })
        ),
        col(
          { flexGrow: 1, overflow: "hidden", paddingTop: 4 },
          ...REVIEWS.slice(0, 5).map((r) => reviewRow(s, r, { lines: 2 }))
        ),
        row(
          { padding: "8px 16px", gap: 8, background: T.canvas },
          row(
            {
              flexGrow: 1,
              height: 44,
              padding: "0 14px",
              gap: 8,
              borderRadius: T.pill,
              background: T.fill2,
            },
            icon("search", 18, T.muted),
            text({ fontSize: 16, color: T.muted }, "Search reviews")
          ),
          row(
            {
              width: 44,
              height: 44,
              borderRadius: T.pill,
              background: T.fill2,
              justifyContent: "center",
            },
            icon("list-filter", 20, T.ink2)
          )
        ),
        tabbar(s, "inbox"),
        conceptTag("Concept · sample data", { left: 112, top: 14 })
      )
    },
  },

  "inbox-phone-detail": {
    title: "Inbox review detail · phone 390 · failed, retry",
    width: 390,
    height: 844,
    build() {
      const s = SIZE.touch
      const r = REVIEWS[3]
      return col(
        { width: "100%", height: "100%", background: T.surface },
        appbar(s, { back: "Inbox", actions: ["ellipsis"] }),
        col(
          { flexGrow: 1, padding: "16px", gap: 14, overflow: "hidden" },
          row(
            { gap: 12 },
            avatar(r.init, 40),
            col(
              { gap: 3 },
              text({ fontSize: 17, fontWeight: 600, color: T.ink }, r.who),
              row(
                { gap: 6 },
                stars(r.n, 14),
                text(
                  { fontSize: 13, color: T.muted },
                  "Yesterday · Harbour Kitchen"
                )
              )
            )
          ),
          text({ fontSize: 17, lineHeight: "28px", color: T.ink }, r.body),
          col(
            { gap: 8 },
            text(
              { fontSize: 13, fontWeight: 600, color: T.muted },
              "Where this reply is"
            ),
            changeTrack(s, 2, { failedAt: 2, failedLabel: "Failed" })
          ),
          col(
            {
              gap: 8,
              padding: 14,
              borderRadius: T.rCard,
              background: T.dangerTint,
              border: `1px solid ${T.dangerSolid}`,
            },
            row(
              { gap: 8 },
              icon("triangle-alert", 18, T.danger, 2),
              text(
                { fontSize: 15, fontWeight: 700, color: T.danger },
                "Google refused this client's login"
              )
            ),
            text(
              { fontSize: 15, lineHeight: "21px", color: T.ink },
              "Access for ops@harbourkitchen.example expired at 09:12, so Google turned the reply away. Nothing changed on Google. Reconnect the account, then send the approved reply again."
            ),
            text(
              { fontSize: 13, color: T.muted },
              "Attempt 1 · Error reference GBP-401"
            )
          ),
          draftBlock(s, {
            locked: true,
            lockLabel: "Approved text",
            text: "Hi Raj, I'm so sorry we lost your booking. That should never happen. Next time, ask for me at the door and I'll make sure you get the table you booked. Ana, Manager",
            meta: "Approved by Priya 09:10 · Saved here",
          })
        ),
        dispatchBar(s, {
          docked: true,
          stack: true,
          status: "failed",
          label: "Failed: retry",
          sub: "Not on Google. Reconnect first; retrying sends the approved text unchanged.",
          actions: [
            button(s, "Reconnect", { kind: "onCharcoal", icon: "plug" }),
            button(s, "Retry sending", {
              kind: "send",
              icon: "refresh-cw",
              style: { flexGrow: 1 },
            }),
          ],
        }),
        homeIndicatorDark(),
        conceptTag("Concept · sample data", { left: 112, top: 14 })
      )
    },
  },
}
