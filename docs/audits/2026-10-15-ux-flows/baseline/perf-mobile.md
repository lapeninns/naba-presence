Profile **mobile**, 3 cold runs per route, medians. 2026-10-14T23:25:17.598Z against http://localhost:3220.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /inbox | 45 | 1236 | 1236 | 0.001 | 104 | 94 | 72 | 60 | 558 | 1555 | 552 | 6 | 67 | 642 | 3 | 0 | 3 | 390 |
| /inbox?selected={review} | 44 | 1228 | 1228 | 0.003 | 116 | 88 | – | 60 | 558 | 1555 | 552 | 6 | 69 | 646 | 4 | 0 | 4 | 510 |
| /listings | 38 | 1240 | 1240 | 0.000 | 87 | 101 | 40 | 58 | 498 | 1456 | 492 | 6 | 66 | 580 | 4 | 0 | 4 | 344 |
| /listings/{loc} | 41 | 1228 | 1228 | 0.000 | 108 | 107 | – | 56 | 496 | 1377 | 490 | 6 | 63 | 581 | 3 | 0 | 3 | 501 |
| /listings/{loc}/hours | 37 | 1192 | 1192 | 0.000 | 131 | 109 | – | 63 | 535 | 1466 | 529 | 6 | 70 | 625 | 3 | 0 | 3 | 530 |
| /listings/{loc}/photos | 41 | 1180 | 1180 | 0.000 | 114 | 109 | – | 57 | 506 | 1404 | 500 | 6 | 64 | 593 | 3 | 0 | 3 | 359 |
| /listings/{loc}/posts | 38 | 1228 | 1228 | 0.000 | 164 | 128 | – | 59 | 537 | 1496 | 531 | 6 | 67 | 624 | 4 | 0 | 4 | 344 |
| /reports | 35 | 1248 | 1248 | 0.018 | 117 | 92 | 32 | 57 | 499 | 1391 | 493 | 6 | 66 | 589 | 5 | 0 | 5 | 790 |
| /calendar | 28 | 1216 | 1216 | 0.000 | 71 | 93 | – | 53 | 471 | 1314 | 465 | 6 | 60 | 548 | 3 | 0 | 3 | 234 |
| /clients | 36 | 1244 | 1244 | 0.000 | 63 | 90 | – | 53 | 457 | 1278 | 428 | 29 | 65 | 541 | 8 | 4 | 4 | 304 |
| /settings | 36 | 1228 | 1228 | 0.000 | 77 | 93 | 32 | 60 | 507 | 1387 | 501 | 6 | 80 | 592 | 16 | 10 | 6 | 306 |
| /settings/billing | 36 | 1216 | 3336 | 0.000 | 117 | 114 | – | 63 | 521 | 1439 | 449 | 72 | 84 | 605 | 17 | 14 | 3 | 339 |
| /setup | 33 | 1240 | 1240 | 0.000 | 61 | 87 | 32 | 54 | 482 | 1354 | 442 | 41 | 64 | 563 | 6 | 3 | 3 | 264 |
| /sign-in | 6 | 1228 | 1228 | 0.000 | 35 | 85 | 32 | 28 | 254 | 710 | 245 | 8 | 39 | 344 | 7 | 7 | 0 | 118 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.

**Budget breaches (4)**

- /inbox: firstLoadJsTransfer 552 KB > 520
- /inbox?selected={review}: firstLoadJsTransfer 552 KB > 520
- /settings/billing: lcp 3336 > 1500
- /settings/billing: otherJsTransfer 72 KB > 60
