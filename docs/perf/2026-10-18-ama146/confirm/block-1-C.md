Profile **mobile**, 5 cold runs per route, medians. 2026-10-18T23:40:51.618Z against http://127.0.0.1:49972.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /inbox | 31 | 1256 | 1256 | 0.001 | 64 | 87 | 16 | 67 | 561 | 1535 | 507 | 54 | 74 | 647 | 3 | 0 | 3 | 434 |
| /listings | 20 | 1248 | 1248 | 0.000 | 76 | 88 | 96 | 65 | 516 | 1480 | 510 | 6 | 72 | 597 | 3 | 0 | 3 | 331 |
| /listings/{loc}/profile | 35 | 1256 | 1256 | 0.045 | 99 | 92 | 16 | 80 | 627 | 1776 | 586 | 40 | 92 | 725 | 8 | 0 | 8 | 874 |

Times in ms. INP probe = longest observed Event Timing/first-input duration attributed to one tap/click, not field INP.

Every requested cold run has valid navigation, quiet-window and interaction evidence.

All budgets met.
