Profile **desktop**, 2 cold runs per route, medians. 2026-10-18T10:18:50.225Z against http://127.0.0.1:63270.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /listings/{loc}/hours | 22 | 84 | 852 | 0.001 | 0 | 0 | 24 | 72 | 554 | 1488 | 547 | 6 | 79 | 643 | 3 | 0 | 3 | 482 |
| /listings/{loc}/photos | 27 | 90 | 846 | 0.001 | 0 | 0 | 24 | 68 | 530 | 1432 | 523 | 6 | 75 | 618 | 3 | 0 | 3 | 378 |
| /sign-in | 5 | 58 | 58 | 0.000 | 0 | 0 | 16 | 30 | 259 | 717 | 251 | 8 | 41 | 350 | 7 | 7 | 0 | 119 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.

All budgets met.
