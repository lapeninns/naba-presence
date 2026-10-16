Profile **mobile**, 3 cold runs per route, medians. 2026-10-16T20:00:15.315Z against http://localhost:3220.

| Route | TTFB | FCP | LCP | CLS | TBT | Longest task | INP probe | JS req | JS KB (xfer) | JS KB (decoded) | First-load JS KB (xfer) | Prefetch/lazy JS KB | Req | Total KB | Fetch/XHR | of which RSC | of which /api | DOM nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| /inbox | 46 | 1260 | 1260 | 0.001 | 58 | 89 | 80 | 66 | 552 | 1510 | 519 | 33 | 73 | 636 | 3 | 0 | 3 | 421 |
| /inbox?selected={review} | 40 | 1216 | 1216 | 0.004 | 74 | 87 | – | 67 | 554 | 1512 | 519 | 35 | 76 | 642 | 4 | 0 | 4 | 530 |
| /listings | 42 | 1248 | 1248 | 0.044 | 72 | 89 | – | 63 | 510 | 1466 | 504 | 6 | 71 | 591 | 4 | 0 | 4 | 329 |
| /listings/{loc} | 43 | 1232 | 1232 | 0.000 | 80 | 90 | – | 67 | 525 | 1423 | 519 | 6 | 74 | 611 | 3 | 0 | 3 | 489 |
| /listings/{loc}/hours | 40 | 1196 | 1196 | 0.000 | 71 | 87 | 88 | 72 | 551 | 1481 | 545 | 6 | 79 | 640 | 3 | 0 | 3 | 457 |
| /listings/{loc}/photos | 33 | 1184 | 1184 | 0.000 | 77 | 88 | 88 | 68 | 527 | 1425 | 521 | 6 | 75 | 615 | 3 | 0 | 3 | 358 |
| /listings/{loc}/posts | 36 | 1224 | 1224 | 0.000 | 79 | 93 | 88 | 72 | 562 | 1523 | 556 | 6 | 80 | 649 | 4 | 0 | 4 | 347 |
| /listings/{loc}/profile | 40 | 1124 | 1420 | 0.053 | 93 | 90 | 104 | 78 | 621 | 1764 | 594 | 27 | 90 | 721 | 8 | 0 | 8 | 876 |
| /listings/{loc}/menu | 33 | 1188 | 1188 | 0.000 | 71 | 89 | 88 | 71 | 549 | 1479 | 543 | 6 | 78 | 636 | 3 | 0 | 3 | 338 |
| /listings/{loc}/booking | 40 | 1176 | 1176 | 0.000 | 90 | 94 | 88 | 70 | 538 | 1455 | 532 | 6 | 78 | 626 | 4 | 0 | 4 | 379 |
| /listings/{loc}/people | 38 | 1132 | 1672 | 0.000 | 63 | 73 | 88 | 69 | 571 | 1581 | 565 | 6 | 78 | 661 | 5 | 0 | 5 | 414 |
| /listings/{loc}/verification | 32 | 1180 | 1468 | 0.000 | 79 | 92 | 96 | 69 | 571 | 1581 | 565 | 6 | 78 | 661 | 5 | 0 | 5 | 409 |
| /listings/{loc}/suggestions | 37 | 1220 | 1220 | 0.000 | 83 | 100 | 88 | 65 | 510 | 1388 | 504 | 6 | 72 | 596 | 3 | 0 | 3 | 325 |
| /listings/{loc}/changes | 34 | 1224 | 1224 | 0.000 | 83 | 89 | 88 | 70 | 534 | 1442 | 526 | 9 | 86 | 633 | 12 | 2 | 10 | 299 |
| /reports | 38 | 1240 | 4172 | 0.016 | 104 | 91 | 32 | 67 | 525 | 1432 | 519 | 6 | 76 | 615 | 5 | 0 | 5 | 683 |
| /calendar | 33 | 1228 | 1228 | 0.000 | 60 | 87 | – | 57 | 482 | 1330 | 476 | 6 | 66 | 560 | 5 | 2 | 3 | 247 |
| /clients | 34 | 1228 | 1228 | 0.000 | 60 | 83 | – | 61 | 483 | 1321 | 454 | 29 | 73 | 566 | 8 | 4 | 4 | 288 |
| /settings | 38 | 1220 | 1220 | 0.000 | 62 | 86 | 32 | 65 | 520 | 1410 | 512 | 8 | 84 | 608 | 15 | 10 | 5 | 325 |
| /settings/notifications | 32 | 1236 | 1236 | 0.000 | 66 | 95 | – | 58 | 481 | 1316 | 475 | 6 | 65 | 562 | 3 | 0 | 3 | 390 |
| /team | 38 | 1244 | 1244 | 0.000 | 73 | 85 | 104 | 58 | 484 | 1339 | 478 | 6 | 65 | 570 | 3 | 0 | 3 | 566 |
| /settings/billing | 35 | 1236 | 1236 | 0.000 | 69 | 95 | – | 66 | 533 | 1447 | 527 | 6 | 73 | 612 | 3 | 0 | 3 | 260 |
| /setup | 29 | 1240 | 1240 | 0.000 | 64 | 87 | 32 | 62 | 502 | 1378 | 461 | 41 | 72 | 583 | 6 | 3 | 3 | 276 |
| /sign-in | 6 | 1248 | 1248 | 0.000 | 30 | 80 | 32 | 38 | 298 | 811 | 285 | 13 | 49 | 388 | 7 | 7 | 0 | 119 |

Times in ms. INP probe = longest Event Timing duration for one tap/click on the probe control.

**Budget breaches (10)**

- /listings/{loc}/profile: firstLoadJsTransfer 594 KB > 520
- /listings/{loc}/menu: firstLoadJsTransfer 543 KB > 520
- /listings/{loc}/booking: firstLoadJsTransfer 532 KB > 520
- /listings/{loc}/people: lcp 1672 > 1500
- /listings/{loc}/people: firstLoadJsTransfer 565 KB > 520
- /listings/{loc}/verification: firstLoadJsTransfer 565 KB > 520
- /listings/{loc}/changes: firstLoadJsTransfer 526 KB > 520
- /reports: lcp 4172 > 1500
- /settings/billing: firstLoadJsTransfer 527 KB > 520
- /sign-in: firstLoadJsTransfer 285 KB > 260
