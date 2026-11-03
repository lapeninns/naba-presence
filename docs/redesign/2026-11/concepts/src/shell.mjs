// The shell, DIRECTION.md §5: phone app bar + tab bar, tablet rail + top bar,
// desktop sidebar + top bar. Scope lives in exactly one place per size.

import {
  T,
  avatar,
  col,
  countBadge,
  h,
  icon,
  row,
  spacer,
  text,
} from "./kit.mjs"

export const NAV = [
  ["inbox", "Inbox", "inbox", 12],
  ["listings", "Listings", "store", null],
  ["clients", "Clients", "building-2", null],
  ["calendar", "Calendar", "calendar-days", null],
  ["reports", "Reports", "chart-column", null],
]
export const NAV_WORKSPACE = [
  ["team", "Team", "users", null],
  ["settings", "Settings", "settings", null],
]

// The product mark: a green monogram, the brand's one accent.
export function brand(size = 28) {
  return text(
    {
      width: size,
      height: size,
      borderRadius: 6,
      background: T.accent,
      color: "#fff",
      fontSize: size * 0.5,
      fontWeight: 700,
      justifyContent: "center",
      alignItems: "center",
      flexShrink: 0,
    },
    "N"
  )
}

// Scope switcher button: who am I working on? (desk/tablet form)
export function scopeButton(s, opts = {}) {
  const {
    name = "Journey Hospitality",
    sub = "9 listings · 1 needs attention",
    health = "attention",
    open = false,
    width = "100%",
  } = opts
  const dot =
    health === "attention"
      ? T.warningSolid
      : health === "bad"
        ? T.dangerSolid
        : T.quaternary
  return row(
    {
      width,
      gap: 10,
      padding: "8px 10px",
      borderRadius: T.rControl,
      border: `1px solid ${open ? T.ink : T.line}`,
      background: T.surface,
      boxShadow: open
        ? `0 0 0 2px ${T.surface}, 0 0 0 4px ${T.focus}`
        : undefined,
    },
    text(
      {
        width: 28,
        height: 28,
        borderRadius: 6,
        background: "#3F5E52",
        color: "#fff",
        fontSize: 13,
        fontWeight: 700,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
      },
      name[0]
    ),
    col(
      { flexGrow: 1, gap: 1, minWidth: 0 },
      text(
        { fontSize: s.ui, fontWeight: 600, color: T.ink, lineHeight: 1.2 },
        name
      ),
      row(
        { gap: 5 },
        h("div", {
          display: "flex",
          width: 7,
          height: 7,
          borderRadius: 9,
          background: dot,
        }),
        text({ fontSize: s.caption, color: T.muted }, sub)
      )
    ),
    icon("chevrons-up-down", 16, T.muted)
  )
}

// Desktop sidebar, 240px. Current row: neutral fill + ink + semibold, no bar.
export function sidebar(s, current, opts = {}) {
  const navRow = ([id, label, ic, count], extra = {}) => {
    const on = id === current
    return row(
      {
        height: 34,
        padding: "0 10px",
        gap: 10,
        borderRadius: T.rControl,
        background: on ? T.fill : "transparent",
        width: "100%",
      },
      icon(ic, 17, on ? T.ink : T.ink2, on ? 2 : 1.75),
      text(
        {
          fontSize: s.ui,
          fontWeight: on ? 600 : 500,
          color: T.ink,
          flexGrow: 1,
        },
        label
      ),
      count != null
        ? text(
            {
              fontSize: s.caption,
              color: on ? T.ink : T.muted,
              fontWeight: 600,
            },
            String(count)
          )
        : null,
      extra.failed
        ? row(
            { gap: 3 },
            icon("triangle-alert", 13, T.danger, 2.25),
            text(
              { fontSize: s.caption, color: T.danger, fontWeight: 600 },
              String(extra.failed)
            )
          )
        : null
    )
  }
  return col(
    {
      width: 240,
      height: "100%",
      background: T.canvas,
      boxShadow: `inset -1px 0 0 ${T.line}`,
      padding: "14px 12px",
      gap: 4,
      flexShrink: 0,
    },
    row(
      { gap: 10, padding: "2px 6px 12px" },
      brand(26),
      col(
        { gap: 0 },
        text(
          { fontSize: 14, fontWeight: 700, color: T.ink },
          "Northgate Agency"
        ),
        text({ fontSize: 12, color: T.muted }, "NabaPresence")
      )
    ),
    text(
      {
        fontSize: s.caption,
        fontWeight: 600,
        color: T.muted,
        padding: "0 4px 6px",
      },
      "Working on"
    ),
    scopeButton(s, { open: opts.scopeOpen }),
    h("div", { display: "flex", height: 14 }),
    ...NAV.map((n) => navRow(n)),
    row(
      { height: 34, padding: "0 10px", gap: 10, width: "100%" },
      icon("send", 17, T.ink2),
      text(
        { fontSize: s.ui, fontWeight: 500, color: T.ink, flexGrow: 1 },
        "Outbox"
      ),
      row(
        { gap: 3 },
        icon("triangle-alert", 13, T.danger, 2.25),
        text(
          { fontSize: s.caption, color: T.danger, fontWeight: 600 },
          "1 failed"
        )
      )
    ),
    h("div", { display: "flex", height: 16 }),
    text(
      {
        fontSize: s.caption,
        fontWeight: 600,
        color: T.muted,
        padding: "0 10px 4px",
      },
      "Workspace"
    ),
    ...NAV_WORKSPACE.map((n) => navRow(n)),
    spacer(),
    row(
      { gap: 10, padding: "10px 6px 0", borderTop: `1px solid ${T.line}` },
      avatar("AS", 30),
      col(
        { flexGrow: 1, gap: 0 },
        text(
          { fontSize: s.ui, fontWeight: 600, color: T.ink },
          "Asha Shrestha"
        ),
        text({ fontSize: 12, color: T.muted }, "Owner")
      ),
      icon("ellipsis", 18, T.muted)
    )
  )
}

// Desktop / tablet top bar, 56px: trail (or back), search, bell.
export function topbar(s, opts = {}) {
  const {
    trail = [],
    back = null,
    scope = null,
    search = true,
    bell = 3,
    wide = true,
  } = opts
  return row(
    {
      height: 56,
      padding: "0 20px",
      gap: 14,
      boxShadow: `inset 0 -1px 0 ${T.line}`,
      background: T.canvas,
      width: "100%",
      flexShrink: 0,
    },
    scope,
    back
      ? row(
          { gap: 4 },
          icon("chevron-left", 18, T.ink2, 2),
          text({ fontSize: s.ui, fontWeight: 600, color: T.ink }, back)
        )
      : row(
          { gap: 6 },
          ...trail.flatMap((t, i) => [
            i ? text({ fontSize: s.ui, color: T.quaternary }, "/") : null,
            text(
              {
                fontSize: s.ui,
                fontWeight: i === trail.length - 1 ? 600 : 500,
                color: i === trail.length - 1 ? T.ink : T.muted,
              },
              t
            ),
          ])
        ),
    spacer(),
    search
      ? wide
        ? row(
            {
              width: 300,
              height: 36,
              padding: "0 10px",
              gap: 8,
              borderRadius: T.rControl,
              border: `1px solid ${T.line}`,
              background: T.surface,
            },
            icon("search", 16, T.muted),
            text(
              { fontSize: s.ui, color: T.muted, flexGrow: 1 },
              "Search reviews, listings, clients"
            ),
            text(
              {
                fontSize: 11,
                color: T.muted,
                padding: "1px 5px",
                border: `1px solid ${T.line}`,
                borderRadius: 4,
              },
              "⌘K"
            )
          )
        : h(
            "div",
            {
              display: "flex",
              width: s.control,
              height: s.control,
              alignItems: "center",
              justifyContent: "center",
            },
            icon("search", 20, T.ink2)
          )
      : null,
    row(
      {
        width: s.control,
        height: s.control,
        justifyContent: "center",
        position: "relative",
      },
      icon("bell", 20, T.ink2),
      bell
        ? h("div", {
            display: "flex",
            position: "absolute",
            top: wide ? 4 : 8,
            right: wide ? 4 : 8,
            width: 8,
            height: 8,
            borderRadius: 9,
            background: T.infoSolid,
            border: `2px solid ${T.canvas}`,
          })
        : null
    )
  )
}

// Tablet rail, 72px, labelled tiles.
export function rail(s, current) {
  const tile = ([id, label, ic, count]) => {
    const on = id === current
    return col(
      {
        width: 60,
        height: 56,
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        borderRadius: T.rControl,
        background: on ? T.fill : "transparent",
        position: "relative",
      },
      icon(ic, 22, on ? T.ink : T.ink2, on ? 2 : 1.75),
      text({ fontSize: 12, fontWeight: on ? 600 : 500, color: T.ink }, label),
      count
        ? h(
            "div",
            { display: "flex", position: "absolute", top: 4, right: 8 },
            countBadge(s, count, { strong: true })
          )
        : null
    )
  }
  return col(
    {
      width: 72,
      height: "100%",
      background: T.canvas,
      boxShadow: `inset -1px 0 0 ${T.line}`,
      alignItems: "center",
      padding: "12px 0",
      gap: 6,
      flexShrink: 0,
    },
    brand(30),
    h("div", { display: "flex", height: 8 }),
    ...NAV.map(tile),
    tile(["outbox", "Outbox", "send", null]),
    h("div", { display: "flex", height: 8 }),
    ...NAV_WORKSPACE.map(tile),
    spacer(),
    avatar("AS", 34)
  )
}

// Phone app bar, 52px (+ safe top). Top-level: scope chip; deep: back link.
export function appbar(s, opts = {}) {
  const {
    back = null,
    title = null,
    scope = "Journey Hospitality",
    actions = ["search", "bell"],
  } = opts
  return col(
    {
      width: "100%",
      background: T.canvas,
      boxShadow: `inset 0 -1px 0 ${T.line}`,
      flexShrink: 0,
    },
    statusBarPhone(),
    row(
      { height: 52, padding: "0 8px 0 12px", gap: 6 },
      back
        ? row(
            { gap: 2, height: 44 },
            icon("chevron-left", 22, T.ink, 2.25),
            text({ fontSize: 16, fontWeight: 500, color: T.ink }, back)
          )
        : row(
            {
              gap: 8,
              height: 36,
              padding: "0 10px 0 4px",
              borderRadius: T.pill,
              border: `1px solid ${T.line}`,
              background: T.surface,
            },
            text(
              {
                width: 26,
                height: 26,
                borderRadius: 13,
                background: "#3F5E52",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                justifyContent: "center",
                alignItems: "center",
              },
              scope[0]
            ),
            text({ fontSize: 15, fontWeight: 600, color: T.ink }, scope),
            h("div", {
              display: "flex",
              width: 7,
              height: 7,
              borderRadius: 9,
              background: T.warningSolid,
            }),
            icon("chevron-down", 16, T.muted, 2)
          ),
      title
        ? text(
            {
              fontSize: 16,
              fontWeight: 600,
              color: T.ink,
              flexGrow: 1,
              justifyContent: "center",
            },
            title
          )
        : spacer(),
      ...actions.map((a) =>
        row(
          {
            width: 44,
            height: 44,
            justifyContent: "center",
            position: "relative",
          },
          icon(a, 22, T.ink2),
          a === "bell"
            ? h("div", {
                display: "flex",
                position: "absolute",
                top: 10,
                right: 10,
                width: 8,
                height: 8,
                borderRadius: 9,
                background: T.infoSolid,
                border: `2px solid ${T.canvas}`,
              })
            : null
        )
      )
    )
  )
}

export function statusBarPhone() {
  return row(
    { height: 47, padding: "0 28px 0 34px", justifyContent: "space-between" },
    text({ fontSize: 16, fontWeight: 600, color: T.ink }, "9:41"),
    row(
      { gap: 6 },
      icon("signal", 16, T.ink, 2.5),
      icon("wifi", 16, T.ink, 2.5),
      icon("battery-full", 20, T.ink, 2)
    )
  )
}

// Phone tab bar: 4 destinations + More. Current: ink icon (filled weight) + semibold label.
export function tabbar(s, current, opts = {}) {
  const tabs = opts.tabs ?? [
    ["inbox", "Inbox", "inbox", 12],
    ["listings", "Listings", "store", null],
    ["clients", "Clients", "building-2", null],
    ["reports", "Reports", "chart-column", null],
    ["more", "More", "ellipsis", null],
  ]
  return col(
    {
      width: "100%",
      background: T.canvas,
      boxShadow: `inset 0 1px 0 ${T.line}`,
      flexShrink: 0,
    },
    row(
      { height: 56, padding: "0 4px" },
      ...tabs.map(([id, label, ic, count]) => {
        const on = id === current
        return col(
          {
            flexGrow: 1,
            flexBasis: 0,
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            position: "relative",
            height: 56,
          },
          row(
            {
              width: 56,
              height: 28,
              borderRadius: T.pill,
              justifyContent: "center",
              background: on ? T.fill : "transparent",
            },
            icon(ic, 22, on ? T.ink : T.ink2, on ? 2.25 : 1.75)
          ),
          text(
            {
              fontSize: 12,
              fontWeight: on ? 600 : 500,
              color: on ? T.ink : T.ink2,
            },
            label
          ),
          count
            ? h(
                "div",
                { display: "flex", position: "absolute", top: 3, left: "52%" },
                countBadge(s, count, { strong: true })
              )
            : null
        )
      })
    ),
    homeIndicator()
  )
}

export function homeIndicator() {
  return row(
    { height: 34, justifyContent: "center" },
    h("div", {
      display: "flex",
      width: 134,
      height: 5,
      borderRadius: 3,
      background: T.ink,
    })
  )
}

// Tablet scope pill (start of the top bar between md and wide).
export function scopePill(name = "Journey Hospitality") {
  return row(
    {
      height: 44,
      padding: "0 12px 0 6px",
      gap: 8,
      borderRadius: T.pill,
      border: `1px solid ${T.line}`,
      background: T.surface,
      flexShrink: 0,
    },
    text(
      {
        width: 30,
        height: 30,
        borderRadius: 15,
        background: "#3F5E52",
        color: "#fff",
        fontSize: 13,
        fontWeight: 700,
        justifyContent: "center",
        alignItems: "center",
      },
      name[0]
    ),
    text({ fontSize: 15, fontWeight: 600, color: T.ink }, name),
    h("div", {
      display: "flex",
      width: 7,
      height: 7,
      borderRadius: 9,
      background: T.warningSolid,
    }),
    text({ fontSize: 13, color: T.muted }, "1 needs attention"),
    icon("chevron-down", 16, T.muted, 2)
  )
}
