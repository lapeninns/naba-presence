// Concept 4: team management and settings.
import {
  SIZE,
  T,
  avatar,
  button,
  card,
  col,
  conceptTag,
  field,
  h,
  icon,
  row,
  spacer,
  text,
} from "./kit.mjs"
import { appbar, rail, sidebar, topbar } from "./shell.mjs"

const MEMBERS = [
  [
    "Asha Shrestha",
    "asha@northgate.example",
    "AS",
    "Owner",
    "All clients",
    "Can publish",
    "You",
  ],
  [
    "Priya Nair",
    "priya@northgate.example",
    "PN",
    "Admin",
    "All clients",
    "Can publish",
  ],
  [
    "Sam Wood",
    "sam@northgate.example",
    "SW",
    "Member",
    "Journey Hospitality, Harbour Collective",
    "Can publish",
  ],
  [
    "Jo Clarke",
    "jo@northgate.example",
    "JC",
    "Member",
    "Journey Hospitality",
    "Drafts only",
  ],
  [
    "Ola Bello",
    "ola@client.example",
    "OB",
    "Viewer",
    "Journey Hospitality",
    "View only",
  ],
]

const rolePill = (s, r) =>
  text(
    {
      fontSize: s.caption,
      fontWeight: 600,
      color: T.ink2,
      padding: "2px 8px",
      borderRadius: T.rTag,
      background: T.fill,
    },
    r
  )
const publishWord = (s, p) => {
  const ic =
    p === "Can publish"
      ? ["send", T.ink]
      : p === "Drafts only"
        ? ["pencil", T.ink2]
        : ["eye", T.muted]
  return row(
    { gap: 6 },
    icon(ic[0], 14, ic[1], 2),
    text({ fontSize: s.body, color: p === "View only" ? T.muted : T.ink }, p)
  )
}

function toggle(on) {
  return row(
    {
      width: 44,
      height: 26,
      borderRadius: 13,
      padding: 3,
      background: on ? T.ink : T.lineStrong,
      justifyContent: on ? "flex-end" : "flex-start",
      flexShrink: 0,
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

export const team = {
  "team-desktop": {
    title: "Team · desktop 1440",
    width: 1440,
    height: 900,
    build() {
      const s = SIZE.desk
      const cols = [
        ["Member", 300],
        ["Role", 110],
        ["Client access", 300],
        ["Publishing", 160],
        ["Joined", 110],
        ["", 40],
      ]
      return row(
        { width: "100%", height: "100%", background: T.canvas },
        sidebar(s, "team"),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, { trail: ["Team"] }),
          col(
            { padding: "22px 32px", gap: 18, maxWidth: 1200 },
            row(
              { gap: 10, alignItems: "flex-start" },
              col(
                { gap: 6, flexGrow: 1 },
                text({ fontSize: 26, fontWeight: 700, color: T.ink }, "Team"),
                text(
                  { fontSize: s.body, color: T.muted },
                  "Who can see and act on your clients' reviews and listings."
                )
              ),
              button(s, "Invite a teammate", {
                kind: "primary",
                icon: "user-plus",
              })
            ),
            row(
              { gap: 8 },
              text(
                { fontSize: s.section, fontWeight: 600, color: T.ink },
                "Members"
              ),
              text({ fontSize: s.body, color: T.muted }, "5 people · 1 owner"),
              spacer(),
              row(
                {
                  width: 240,
                  height: 32,
                  padding: "0 10px",
                  gap: 8,
                  borderRadius: T.rControl,
                  border: `1px solid ${T.line}`,
                  background: T.surface,
                },
                icon("search", 15, T.muted),
                text({ fontSize: s.ui, color: T.muted }, "Find a member")
              )
            ),
            card(
              { overflow: "hidden" },
              row(
                {
                  padding: "0 16px",
                  height: 38,
                  boxShadow: `inset 0 -1px 0 ${T.line}`,
                },
                ...cols.map(([c, w], i) =>
                  text(
                    {
                      width: w,
                      flexGrow: i === 2 ? 1 : 0,
                      fontSize: s.caption + 1,
                      fontWeight: 500,
                      color: T.muted,
                    },
                    c
                  )
                )
              ),
              ...MEMBERS.map(([name, email, init, role, access, pub, you], i) =>
                row(
                  {
                    padding: "0 16px",
                    height: 58,
                    boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
                    background: i === 3 ? T.fill2 : T.surface,
                  },
                  row(
                    { width: 300, gap: 10 },
                    avatar(init, 32),
                    col(
                      { gap: 1 },
                      row(
                        { gap: 6 },
                        text(
                          { fontSize: s.body, fontWeight: 600, color: T.ink },
                          name
                        ),
                        you
                          ? text(
                              {
                                fontSize: 11,
                                fontWeight: 600,
                                color: T.ink2,
                                padding: "1px 6px",
                                borderRadius: T.rTag,
                                background: T.fill,
                              },
                              "You"
                            )
                          : null
                      ),
                      text({ fontSize: s.caption, color: T.muted }, email)
                    )
                  ),
                  row({ width: 110 }, rolePill(s, role)),
                  text(
                    { width: 300, flexGrow: 1, fontSize: s.body, color: T.ink },
                    access
                  ),
                  row({ width: 160 }, publishWord(s, pub)),
                  text(
                    { width: 110, fontSize: s.body, color: T.muted },
                    [
                      "Mar 2025",
                      "Apr 2025",
                      "Jun 2025",
                      "Sep 2026",
                      "Oct 2026",
                    ][i]
                  ),
                  row(
                    { width: 40, justifyContent: "flex-end" },
                    icon("ellipsis", 18, T.muted)
                  )
                )
              )
            ),
            row(
              { gap: 8, paddingTop: 6 },
              text(
                { fontSize: s.section, fontWeight: 600, color: T.ink },
                "Invitations"
              ),
              text(
                { fontSize: s.body, color: T.muted },
                "Links expire after 7 days"
              )
            ),
            card(
              { overflow: "hidden" },
              row(
                {
                  padding: "12px 16px",
                  gap: 12,
                  boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
                },
                icon("mail", 18, T.ink2),
                col(
                  { flexGrow: 1, gap: 1 },
                  text(
                    { fontSize: s.body, fontWeight: 600, color: T.ink },
                    "lee@client.example"
                  ),
                  text(
                    { fontSize: s.caption, color: T.muted },
                    "Member · Harbour Collective · Drafts only"
                  )
                ),
                text(
                  { fontSize: s.caption + 1, color: T.muted },
                  "Expires in 5 days"
                ),
                button(s, "Copy link", {
                  kind: "secondary",
                  size: "sm",
                  icon: "copy",
                }),
                button(s, "Revoke", { kind: "ghost", size: "sm" })
              ),
              row(
                { padding: "12px 16px", gap: 12 },
                icon("mail-x", 18, T.muted),
                col(
                  { flexGrow: 1, gap: 1 },
                  text(
                    { fontSize: s.body, fontWeight: 600, color: T.muted },
                    "ben@client.example"
                  ),
                  text(
                    { fontSize: s.caption, color: T.muted },
                    "Viewer · Journey Hospitality"
                  )
                ),
                text(
                  {
                    fontSize: s.caption + 1,
                    color: T.warning,
                    fontWeight: 600,
                  },
                  "Expired 2 Nov"
                ),
                button(s, "Send a new link", { kind: "secondary", size: "sm" })
              )
            ),
            row(
              { gap: 6 },
              icon("info", 15, T.muted),
              text(
                { fontSize: s.caption + 1, color: T.muted },
                "Owners and admins can always publish. A member publishes only when their publishing access is on."
              ),
              text(
                {
                  fontSize: s.caption + 1,
                  color: T.accentInk,
                  fontWeight: 600,
                },
                "What each role can do"
              )
            )
          )
        ),
        conceptTag()
      )
    },
  },

  "settings-tablet": {
    title: "Settings · reply policy · tablet 834",
    width: 834,
    height: 1194,
    build() {
      const s = SIZE.touch
      const sections = [
        ["You", null],
        ["Notifications", "bell"],
        ["Sign-in security", "lock"],
        ["Workspace", null],
        ["Reply policy", "message-square"],
        ["Team", "users"],
        ["Google connections", "plug"],
        ["Operations", "activity"],
        ["Data and privacy", "shield"],
        ["Usage and billing", "credit-card"],
      ]
      const setting = (title, sub, on, extra) =>
        col(
          {
            gap: 10,
            padding: "14px 16px",
            boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
          },
          row(
            { gap: 12, alignItems: "flex-start" },
            col(
              { flexGrow: 1, gap: 3 },
              text({ fontSize: 16, fontWeight: 600, color: T.ink }, title),
              text({ fontSize: 14, color: T.muted, lineHeight: "20px" }, sub)
            ),
            toggle(on)
          ),
          extra ?? null
        )
      return row(
        { width: "100%", height: "100%", background: T.canvas },
        rail(s, "settings"),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, { trail: ["Settings", "Reply policy"], wide: false }),
          row(
            { flexGrow: 1, minHeight: 0, alignItems: "stretch" },
            col(
              {
                width: 230,
                height: "100%",
                padding: "20px 12px",
                gap: 2,
                boxShadow: `inset -1px 0 0 ${T.line}`,
              },
              text(
                {
                  fontSize: 22,
                  fontWeight: 700,
                  color: T.ink,
                  padding: "0 8px 12px",
                },
                "Settings"
              ),
              ...sections.map(([label, ic]) =>
                ic
                  ? row(
                      {
                        height: 44,
                        padding: "0 10px",
                        gap: 10,
                        borderRadius: T.rControl,
                        background:
                          label === "Reply policy" ? T.fill : "transparent",
                      },
                      icon(
                        ic,
                        18,
                        label === "Reply policy" ? T.ink : T.ink2,
                        2
                      ),
                      text(
                        {
                          fontSize: 15,
                          fontWeight: label === "Reply policy" ? 600 : 500,
                          color: T.ink,
                        },
                        label
                      )
                    )
                  : text(
                      {
                        fontSize: 13,
                        fontWeight: 600,
                        color: T.muted,
                        padding: "14px 10px 6px",
                      },
                      label
                    )
              )
            ),
            col(
              { flexGrow: 1, height: "100%" },
              col(
                {
                  flexGrow: 1,
                  padding: "24px 24px",
                  gap: 16,
                  overflow: "hidden",
                },
                col(
                  { gap: 4 },
                  text(
                    { fontSize: 22, fontWeight: 700, color: T.ink },
                    "Reply policy"
                  ),
                  text(
                    { fontSize: 15, color: T.muted, lineHeight: "22px" },
                    "How replies are checked and approved before they reach Google."
                  )
                ),
                text(
                  {
                    fontSize: 13,
                    fontWeight: 600,
                    color: T.muted,
                    paddingTop: 6,
                  },
                  "Approval"
                ),
                card(
                  { overflow: "hidden" },
                  setting(
                    "Require approval before replies publish",
                    "People who can't publish send replies for approval.",
                    true
                  ),
                  setting(
                    "Require a second person to approve",
                    "The person who asked can't approve their own reply.",
                    true,
                    row(
                      {
                        gap: 8,
                        padding: "8px 10px",
                        borderRadius: T.rControl,
                        background: T.fill2,
                      },
                      icon("info", 15, T.ink2),
                      text(
                        { fontSize: 14, color: T.ink2, flexGrow: 1 },
                        "Changed here, not saved yet"
                      )
                    )
                  )
                ),
                text(
                  {
                    fontSize: 13,
                    fontWeight: 600,
                    color: T.muted,
                    paddingTop: 6,
                  },
                  "Review text"
                ),
                card(
                  { padding: 16, gap: 12 },
                  row(
                    { gap: 12 },
                    col(
                      { flexGrow: 1, gap: 3 },
                      text(
                        { fontSize: 16, fontWeight: 600, color: T.ink },
                        "Keep review text for"
                      ),
                      text(
                        { fontSize: 14, color: T.muted },
                        "After this it is deleted here. It stays on Google."
                      )
                    ),
                    row(
                      {
                        height: 44,
                        padding: "0 12px",
                        gap: 8,
                        border: `1px solid ${T.lineStrong}`,
                        borderRadius: T.rControl,
                        background: T.surface,
                      },
                      text({ fontSize: 16, color: T.ink }, "90 days"),
                      icon("chevron-down", 16, T.muted)
                    )
                  )
                ),
                text(
                  {
                    fontSize: 13,
                    fontWeight: 600,
                    color: T.muted,
                    paddingTop: 6,
                  },
                  "Banned phrases"
                ),
                card(
                  { padding: 16, gap: 10 },
                  field(s, null, "Add a phrase replies must never use", {
                    placeholder: true,
                  }),
                  row(
                    { gap: 6, flexWrap: "wrap" },
                    ...["free meal", "refund guaranteed", "call me on"].map(
                      (p) =>
                        row(
                          {
                            gap: 6,
                            height: 30,
                            padding: "0 6px 0 12px",
                            borderRadius: T.pill,
                            background: T.fill,
                          },
                          text({ fontSize: 14, color: T.ink }, p),
                          icon("x", 14, T.muted, 2)
                        )
                    )
                  )
                )
              ),
              col(
                { padding: "0 20px 20px" },
                // A local settings save is not a Google action: surface bar, ink primary.
                row(
                  {
                    gap: 12,
                    padding: "12px 14px 12px 16px",
                    borderRadius: T.rCard,
                    background: T.surface,
                    border: `1px solid ${T.line}`,
                    boxShadow: T.shadowPop,
                  },
                  icon("circle-dashed", 18, T.ink2, 2.25),
                  col(
                    { flexGrow: 1, gap: 2 },
                    text(
                      { fontSize: 15, fontWeight: 600, color: T.ink },
                      "1 unsaved change"
                    ),
                    text(
                      { fontSize: 13, color: T.muted },
                      "Settings are saved in NabaPresence only."
                    )
                  ),
                  button(s, "Discard", { kind: "ghost" }),
                  button(s, "Save", { kind: "primary" })
                )
              )
            )
          )
        ),
        conceptTag("Concept · sample data", { right: 12, bottom: 96 })
      )
    },
  },

  "team-tablet": {
    title: "Team · tablet 834 (settings two-pane, Team section)",
    width: 834,
    height: 1194,
    build() {
      const s = SIZE.touch
      const nav = [
        ["You", null],
        ["Notifications", "bell"],
        ["Sign-in security", "lock"],
        ["Workspace", null],
        ["Reply policy", "message-square"],
        ["Team", "users"],
        ["Google connections", "plug"],
        ["Operations", "activity"],
        ["Data and privacy", "shield"],
        ["Usage and billing", "credit-card"],
      ]
      return row(
        { width: "100%", height: "100%", background: T.canvas },
        rail(s, "team"),
        col(
          { flexGrow: 1, height: "100%" },
          topbar(s, { trail: ["Team"], wide: false }),
          row(
            { flexGrow: 1, minHeight: 0, alignItems: "stretch" },
            col(
              {
                width: 230,
                padding: "20px 12px",
                gap: 2,
                boxShadow: `inset -1px 0 0 ${T.line}`,
              },
              text(
                {
                  fontSize: 22,
                  fontWeight: 700,
                  color: T.ink,
                  padding: "0 8px 12px",
                },
                "Settings"
              ),
              ...nav.map(([label, ic]) =>
                ic
                  ? row(
                      {
                        height: 44,
                        padding: "0 10px",
                        gap: 10,
                        borderRadius: T.rControl,
                        background: label === "Team" ? T.fill : "transparent",
                      },
                      icon(ic, 18, label === "Team" ? T.ink : T.ink2, 2),
                      text(
                        {
                          fontSize: 15,
                          fontWeight: label === "Team" ? 600 : 500,
                          color: T.ink,
                        },
                        label
                      )
                    )
                  : text(
                      {
                        fontSize: 13,
                        fontWeight: 600,
                        color: T.muted,
                        padding: "14px 10px 6px",
                      },
                      label
                    )
              )
            ),
            col(
              { flexGrow: 1, padding: "24px", gap: 14 },
              row(
                { gap: 10, alignItems: "flex-start" },
                col(
                  { flexGrow: 1, gap: 4 },
                  text({ fontSize: 22, fontWeight: 700, color: T.ink }, "Team"),
                  text({ fontSize: 15, color: T.muted }, "5 people · 1 owner")
                ),
                button(s, "Invite", { kind: "primary", icon: "user-plus" })
              ),
              card(
                { overflow: "hidden" },
                ...MEMBERS.map(([name, , init, role, access, pub], i) =>
                  row(
                    {
                      padding: "12px 14px",
                      gap: 12,
                      boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
                      background: i === 3 ? T.fill : T.surface,
                      alignItems: "flex-start",
                    },
                    avatar(init, 36),
                    col(
                      { flexGrow: 1, gap: 4 },
                      row(
                        { gap: 8 },
                        text(
                          { fontSize: 16, fontWeight: 600, color: T.ink },
                          name
                        ),
                        rolePill(s, role)
                      ),
                      text({ fontSize: 14, color: T.muted }, access),
                      publishWord(s, pub)
                    ),
                    icon("chevron-right", 18, T.muted)
                  )
                )
              ),
              text(
                {
                  fontSize: 13,
                  fontWeight: 600,
                  color: T.muted,
                  paddingTop: 8,
                },
                "Invitations"
              ),
              card(
                { overflow: "hidden" },
                row(
                  { padding: "12px 14px", gap: 12 },
                  icon("mail", 18, T.ink2),
                  col(
                    { flexGrow: 1, gap: 2 },
                    text(
                      { fontSize: 16, fontWeight: 600, color: T.ink },
                      "lee@client.example"
                    ),
                    text(
                      { fontSize: 14, color: T.muted },
                      "Member · Harbour Collective · expires in 5 days"
                    )
                  ),
                  button(s, "Copy link", {
                    kind: "secondary",
                    size: "sm",
                    icon: "copy",
                  })
                )
              )
            )
          )
        ),
        conceptTag("Concept · sample data", { right: 12, bottom: 16 })
      )
    },
  },

  "team-phone": {
    title: "Team · invite sheet · phone 390",
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
        appbar(s, { back: "More", title: null, actions: ["user-plus"] }),
        col(
          { padding: "12px 16px", gap: 10 },
          text({ fontSize: 26, fontWeight: 700, color: T.ink }, "Team"),
          card(
            { overflow: "hidden" },
            ...MEMBERS.slice(0, 4).map(([name, , init, role, , pub]) =>
              row(
                {
                  padding: "12px 14px",
                  gap: 12,
                  boxShadow: `inset 0 -1px 0 ${T.lineSubtle}`,
                },
                avatar(init, 36),
                col(
                  { flexGrow: 1, gap: 2 },
                  text({ fontSize: 16, fontWeight: 600, color: T.ink }, name),
                  text({ fontSize: 13, color: T.muted }, `${role} · ${pub}`)
                ),
                icon("chevron-right", 18, T.muted)
              )
            )
          )
        ),
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
            bottom: 0,
            width: 390,
            height: 640,
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
            { padding: "4px 16px 12px", gap: 8 },
            text(
              { fontSize: 18, fontWeight: 700, color: T.ink, flexGrow: 1 },
              "Invite a teammate"
            ),
            button(s, "", { kind: "ghost", iconOnly: true, icon: "x" })
          ),
          col(
            { padding: "0 16px", gap: 16, flexGrow: 1 },
            field(s, "Email address", "lee@client.example", { focus: true }),
            col(
              { gap: 6 },
              text({ fontSize: 15, fontWeight: 600, color: T.ink }, "Role"),
              row(
                {
                  padding: 3,
                  borderRadius: T.rControl + 2,
                  background: T.fill,
                  gap: 2,
                },
                ...["Member", "Viewer", "Admin"].map((r, i) =>
                  text(
                    {
                      flexGrow: 1,
                      height: 38,
                      justifyContent: "center",
                      alignItems: "center",
                      borderRadius: T.rControl,
                      background: i === 0 ? T.surface : "transparent",
                      fontSize: 15,
                      fontWeight: i === 0 ? 600 : 500,
                      color: i === 0 ? T.ink : T.ink2,
                    },
                    r
                  )
                )
              ),
              text(
                { fontSize: 13, color: T.muted },
                "Replies to reviews and edits the clients you choose."
              )
            ),
            col(
              { gap: 6 },
              text(
                { fontSize: 15, fontWeight: 600, color: T.ink },
                "Client access"
              ),
              row(
                {
                  height: 44,
                  padding: "0 12px",
                  gap: 8,
                  border: `1px solid ${T.lineStrong}`,
                  borderRadius: T.rControl,
                },
                text(
                  { fontSize: 16, color: T.ink, flexGrow: 1 },
                  "Harbour Collective"
                ),
                icon("chevron-down", 16, T.muted)
              )
            ),
            row(
              { gap: 12, alignItems: "flex-start" },
              col(
                { flexGrow: 1, gap: 3 },
                text(
                  { fontSize: 16, fontWeight: 600, color: T.ink },
                  "Can publish to Google"
                ),
                text(
                  { fontSize: 13, color: T.muted, lineHeight: "18px" },
                  "Off: their replies and edits wait for approval."
                )
              ),
              toggle(false)
            )
          ),
          col(
            {
              padding: "12px 16px 8px",
              gap: 8,
              boxShadow: `inset 0 1px 0 ${T.line}`,
              background: T.sunken,
            },
            button(s, "Send invitation", {
              kind: "primary",
              style: { width: "100%" },
            })
          ),
          row(
            {
              height: 34,
              justifyContent: "center",
              alignItems: "center",
              background: T.sunken,
            },
            h("div", {
              display: "flex",
              width: 134,
              height: 5,
              borderRadius: 3,
              background: T.ink,
            })
          )
        ),
        conceptTag("Concept · sample data", { left: 112, top: 14 })
      )
    },
  },
}
