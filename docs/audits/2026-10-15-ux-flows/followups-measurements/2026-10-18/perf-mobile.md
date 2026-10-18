Profile **mobile**, 3 cold runs per route, medians. 2026-10-18T10:18:07.715Z against http://127.0.0.1:63270.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /reports | 22 | 1252 | 1252 | 0.000 | 105 | 91 | 32 | 67 | 528 | 1438 | 521 | 6 | 74 | 614 | 3 | 0 | 3 | 683 |
| /listings/{loc}/people | 21 | 1132 | 1644 | 0.000 | 53 | 72 | 88 | 69 | 573 | 1587 | 567 | 6 | 78 | 664 | 5 | 0 | 5 | 412 |
| /sign-in | 5 | 1236 | 1236 | 0.000 | 29 | 79 | 32 | 30 | 259 | 717 | 251 | 8 | 41 | 350 | 7 | 7 | 0 | 117 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.

**Budget breaches (3)**

- /reports: firstLoadJsTransfer 521 KB > 520
- /listings/{loc}/people: lcp 1644 > 1500
- /listings/{loc}/people: firstLoadJsTransfer 567 KB > 520
