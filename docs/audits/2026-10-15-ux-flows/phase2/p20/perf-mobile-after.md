Profile **mobile**, 3 cold runs per route, medians. 2026-10-16T04:34:39.734Z against http://localhost:3220.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /team | 37 | 1244 | 1244 | 0.000 | 77 | 88 | 112 | 57 | 480 | 1333 | 474 | 6 | 64 | 566 | 3 | 0 | 3 | 566 |
| /settings/notifications | 35 | 1236 | 1236 | 0.000 | 48 | 87 | – | 57 | 476 | 1306 | 470 | 6 | 64 | 557 | 3 | 0 | 3 | 390 |
| /settings/policy | 35 | 1212 | 1212 | 0.000 | 65 | 86 | 32 | 64 | 516 | 1401 | 510 | 6 | 73 | 600 | 5 | 0 | 5 | 336 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.
