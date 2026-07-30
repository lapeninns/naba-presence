# A11Y-501 manual accessibility pass

Status: **BLOCKED — staging build and independent NVDA/JAWS environment are
not available**

This document is the execution checklist and result ledger for the manual
accessibility gate. Automated axe coverage is supporting evidence only; it
does not replace the keyboard and assistive-technology sign-off below.

## Required environments

| Environment | Required setup | Status |
|---|---|---|
| Desktop staging | Current staging build, pilot tenant, Chrome or Safari, 1440 × 1000 | BLOCKED — no `STAGING_BASE_URL` or staging credentials |
| Mobile staging | Same build and tenant, 390 × 844 viewport | BLOCKED — no staging build |
| macOS screen reader | Current VoiceOver + Safari | NOT RUN |
| Second screen reader | Current NVDA or JAWS + Chrome/Edge on Windows | BLOCKED — environment unavailable |

Record the exact browser, operating-system, VoiceOver, and NVDA/JAWS versions
before execution.

## Global procedure

For every surface in the matrix:

1. Start before the first interactive control and use only `Tab`,
   `Shift+Tab`, arrow keys, `Enter`, `Space`, and `Escape`.
2. Confirm focus is always visible, follows the visual/reading order, never
   enters hidden content, and is restored to the invoking control after a
   dialog, menu, or detail view closes.
3. Confirm menus and comboboxes use arrow keys, selection is announced, and
   `Escape` closes without committing an unintended change.
4. With VoiceOver and NVDA/JAWS independently, confirm one main landmark,
   labelled navigation, meaningful heading order, named controls, associated
   labels/descriptions, announced validation errors, and dialog focus
   containment/restoration.
5. Trigger loading, success, validation, stale-data, disconnected, and failure
   states where the surface supports them. Confirm asynchronous changes and
   counts are announced once through an appropriate live region without
   stealing focus.
6. Test browser zoom at 200% on desktop and the 390 × 844 viewport. Confirm no
   two-dimensional scrolling, clipped actions, overlapping content, or loss of
   information; data tables may scroll in their labelled container.
7. Enable `prefers-reduced-motion: reduce`. Confirm no non-essential movement
   remains and no interaction depends on animation completing.

Any blocker gets an issue ID, reproduction steps, expected/actual result,
severity, owner, and retest result in the issue log.

## Surface result matrix

Use `PASS`, `FAIL (<issue>)`, or `BLOCKED (<reason>)` in each result column.

| Surface | Keyboard-only checkpoints | Screen-reader checkpoints | 200% / mobile / reduced-motion checkpoints | Result |
|---|---|---|---|---|
| Sign-in | Reach Google action in one logical sequence; activate with Enter/Space | Page title, heading, explanatory copy, and Google action have useful names | Card reflows without clipping | BLOCKED — staging unavailable |
| Invite accept | Traverse invitation details and accept action; exercise expired/error retry | Organisation, invitee, expiry/error, and status changes are announced | Long organisation/email strings wrap | BLOCKED — staging unavailable |
| Inbox + filters | Navigate queues, location/filter controls, rows, pagination, refresh, and mobile navigation; arrow-key combobox behavior | Queue names/counts, selected filters, result-count changes, stale/disconnected banners, and loading states are announced | Queue tabs and filters reflow; no horizontal page overflow | BLOCKED — staging unavailable |
| Review detail + reply editor | Move list → detail → editor; verify focus restoration; open/close confirmation dialogs with Escape; publish/delete controls reachable | Review metadata, language/status, editor label/help/errors, verification result, toasts, and dialog purpose are announced | Editor/actions remain usable at zoom and mobile width | BLOCKED — staging unavailable |
| Approvals | Reach approve/reject, cancel dialogs, and return to originating review | Awaiting-approval state, two-person restriction, decision result, and errors are announced | Decision actions do not overlap or become icon-only without names | BLOCKED — staging unavailable |
| Connections + link/unlink | Navigate account/location controls, menus, link/unlink and disconnect confirmations; restore focus | Connection state, masked/full email by role, location assignment, reconnect errors, and destructive warnings are announced | Location rows and action menus reflow | BLOCKED — staging unavailable |
| Settings | Traverse language/timezone, direct-publish consent, save, privacy, and audit-export controls | Every field has label/current value; save/error and consent consequences are announced | Sections stack without clipped controls | BLOCKED — staging unavailable |
| Members + invitations | Traverse role/publish controls, invitation creation/copy/revoke, and confirmations | Member identity, role, publish permission, invitation status, and validation errors are announced | Tables/cards remain operable at zoom/mobile | BLOCKED — staging unavailable |
| Analytics | Reach range/granularity/location controls and data table | Metric names/values, chart summary, timezone, loading/error, and table headers are announced | Chart does not hide required information; table scroll container is keyboard reachable | BLOCKED — staging unavailable |
| Organisation switcher | Open by keyboard, traverse options, switch, and confirm focus after navigation | Current organisation, option count/selection, and switch completion are announced | Menu remains in viewport at zoom/mobile | BLOCKED — staging unavailable |
| Sign-out | Reach sign-out from desktop and mobile navigation; confirm predictable post-action focus/navigation | Control name and signed-out destination are announced | Mobile navigation closes cleanly | BLOCKED — staging unavailable |

## Dialog and composite-widget ledger

| Control | Expected keyboard behavior | VoiceOver result | NVDA/JAWS result | Status |
|---|---|---|---|---|
| Mobile navigation dialog | Focus enters first meaningful control; Tab is contained; Escape closes; trigger regains focus | NOT RUN | NOT RUN | BLOCKED |
| Publish confirmation | Initial focus is safe; destructive/primary action is explicit; Escape cancels | NOT RUN | NOT RUN | BLOCKED |
| Delete reply confirmation | Warning and irreversible external effect are announced; cancel remains available | NOT RUN | NOT RUN | BLOCKED |
| Disconnect/unlink confirmation | Affected account/location and cleanup consequence are announced | NOT RUN | NOT RUN | BLOCKED |
| Location/filter comboboxes | Arrow keys traverse; Enter selects; Escape closes; value and expanded state announced | NOT RUN | NOT RUN | BLOCKED |
| Overflow menus | Arrow keys traverse enabled items; Escape closes; trigger regains focus | NOT RUN | NOT RUN | BLOCKED |

## Supporting automated evidence

The local WCAG 2.2 AA Playwright/axe suite covers desktop and mobile variants
for the design-system proof, shell, sign-in, invitation, product views, and
review state variants. The current local non-superuser Compose run passed
26/26 on 30 July 2026. This does not satisfy the manual gate because
screen-reader announcements,
focus restoration, composite-widget conventions, and human reflow inspection
require the environments above.

## Issue log

No manual issues are recorded because execution has not begun. Do not interpret
an empty issue log as a pass.

## Sign-off

| Field | Value |
|---|---|
| Tester | BLOCKED — not assigned |
| Date | BLOCKED — execution not run |
| Staging version | BLOCKED — no staging deployment |
| Desktop browser/OS | BLOCKED |
| Mobile browser/viewport | BLOCKED |
| VoiceOver version | BLOCKED |
| NVDA or JAWS version | BLOCKED |
| Result | **NOT SIGNED OFF** |

Release impact: A11Y-501 remains open. Product must not treat the automated
suite or the completed checklist as manual accessibility sign-off.
