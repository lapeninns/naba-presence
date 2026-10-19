Profile **mobile**, 5 cold runs per route, medians. 2026-10-18T22:08:59.616Z against http://127.0.0.1:58849.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /inbox | 22 | 1240 | 1240 | 0.001 | 49 | 80 | 16 | 67 | 561 | 1535 | 507 | 54 | 74 | 647 | 3 | 0 | 3 | 432 |
| /listings | 17 | 1244 | 1244 | 0.000 | 55 | 82 | 80 | 65 | 516 | 1480 | 510 | 6 | 72 | 597 | 3 | 0 | 3 | 331 |
| /listings/{loc}/profile | 25 | 1248 | 1248 | 0.040 | 66 | 84 | 16 | 80 | 627 | 1776 | 586 | 40 | 92 | 725 | 8 | 0 | 8 | 874 |

Times in ms. INP probe = longest observed Event Timing/first-input duration attributed to one tap/click, not field INP.

Every requested cold run has valid navigation, quiet-window and interaction evidence.

**Budget breaches (1)**

- /listings/{loc}/profile: firstLoadJsTransfer 586 KB > 520
