# Mobile quality audit

Base http://localhost:3220 · widths 320, 390, 1280 · themes light, dark · 180 page loads · 219s

## Totals

| Metric | Count |
| --- | --- |
| pages | 180 |
| loadErrors | 0 |
| horizontalOverflow | 0 |
| clippedText | 76 |
| targetSize | 3 |
| touchTargetBelow44 | 260 |
| iosZoomInputs | 0 |
| textUnder12 | 0 |
| textUnder14Phone | 2016 |
| axeViolations | 0 |
| axeNodes | 0 |
| axeCritical | 0 |
| axeSerious | 0 |
| focusObscured | 0 |
| chromeOver25Pct | 0 |
| mainLandmarkNot1 | 0 |
| h1Not1 | 0 |
| missingSkipLink | 0 |
| consoleErrors | 0 |
| pageErrors | 0 |
| phoneChromeMaxPct | 20.4 |
| smallestTextPx | 12 |
| maxOverflowPx | 0 |

## Per route (summed over widths and themes)

| Route | horizontalOverflow | targetSize | touchTargetBelow44 | iosZoomInputs | textUnder12 | axeNodes | focusObscured | chromeOver25Pct | consoleErrors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| /inbox | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| /inbox?selected={review} | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings | 0 | 0 | 18 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc} | 0 | 1 | 24 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/hours | 0 | 0 | 48 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/profile | 0 | 0 | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/photos | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/posts | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/menu | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/booking | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/people | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/suggestions | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/verification | 0 | 0 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/{loc}/changes | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /listings/bulk | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /clients | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | 0 |
| /clients/{client} | 0 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | 0 |
| /clients/{client}/settings | 0 | 0 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| /clients/new | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /calendar | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /reports | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 |
| /notifications | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| /team | 0 | 2 | 18 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/connections | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/notifications | 0 | 0 | 48 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/security | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/privacy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/operations | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/billing | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /settings/usage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| /setup | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| anon:/sign-in | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| anon:/forgot-password | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| anon:/privacy | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| viewer:/inbox | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |

## Top offenders: WCAG 2.5.8 target size

| Component | Count | Routes | Example | Size/By |
| --- | --- | --- | --- | --- |
| [data-slot=switch] | 2 | 1 | span#base-ui-_r_d_[data-slot=switch][role=switch].group/switch.relative | 36x20 |
| [data-slot=card-link] | 1 | 1 | a[data-slot=card-link].text-ink.no-underline | 20x20 |

## Top offenders: touch targets below 44px (phones)

| Component | Count | Routes | Example | Size/By |
| --- | --- | --- | --- | --- |
| [data-slot=button] | 84 | 9 | button[data-slot=button].group/button.relative | 151x20 |
| [data-slot=switch] | 72 | 3 | span#base-ui-_r_9_[data-slot=switch][role=switch].group/switch.relative | 36x20 |
| [data-slot=card-link] | 24 | 1 | a[data-slot=card-link].text-ink.no-underline | 20x20 |
| [data-slot=dropdown-menu-trigger] | 21 | 2 | button#base-ui-_r_4_[data-slot=dropdown-menu-trigger].group/button.relative | 80.6x36 |
| [data-slot=input] | 14 | 5 | input[data-slot=input].h-full.min-w-0 | 195x42 |
| [data-slot=filter-chip] | 11 | 1 | button[data-slot=filter-chip].group/chip.relative | 54.9x28 |
| [data-slot=chip] | 9 | 1 | button[data-slot=chip].group/chip.relative | 58x36 |
| [data-slot=checkbox] | 6 | 2 | span#base-ui-_r_8_[data-slot=checkbox][role=checkbox].relative.flex | 18x18 |
| a in [data-slot=page-frame] | 6 | 2 | a.group/button.relative | 220.3x36 |
| a in [data-slot=table-cell] | 4 | 1 | a.inline-flex.min-h-(--np-control-h) | 180.5x24 |
| [data-slot=tabs-tab] | 3 | 1 | button#base-ui-_R_2n5esnen9eralb_[data-slot=tabs-tab][role=tab].relative.inline-flex | 35.5x44 |
| a in [data-slot=card-content] | 3 | 1 | a.group/button.relative | 136x36 |
| input in [data-slot=tag-input] | 3 | 1 | input#profile-labels.h-7.min-w-[8ch] | 266x28 |

## Top offenders: clipped text without full value

| Component | Count | Routes | Example | Size/By |
| --- | --- | --- | --- | --- |
| span in [data-slot=dropdown-menu-trigger] | 66 | 33 | span.truncate.text-caption |  |
| [data-slot=workspace-name] | 10 | 10 | span[data-slot=workspace-name].min-w-0.truncate |  |
