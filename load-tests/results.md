| Concurrent check-ins | Trial | Succeeded | Error rate | p50 | p95 | p99 | Max | Wall time |
|---|---|---|---|---|---|---|---|---|
| 100 | 1 | 100/100 | 0% | 189 ms | 246 ms | 256 ms | 257 ms | 304 ms |
| 100 | 2 | 100/100 | 0% | 134 ms | 210 ms | 215 ms | 219 ms | 234 ms |
| 100 | 3 | 100/100 | 0% | 151 ms | 256 ms | 263 ms | 268 ms | 284 ms |
| 300 | 1 | 300/300 | 0% | 460 ms | 678 ms | 693 ms | 697 ms | 787 ms |
| 300 | 2 | 300/300 | 0% | 426 ms | 566 ms | 575 ms | 578 ms | 661 ms |
| 300 | 3 | 300/300 | 0% | 368 ms | 507 ms | 520 ms | 523 ms | 597 ms |
| 500 | 1 | 500/500 | 0% | 612 ms | 991 ms | 1017 ms | 1023 ms | 1171 ms |
| 500 | 2 | 500/500 | 0% | 609 ms | 919 ms | 931 ms | 947 ms | 1081 ms |
| 500 | 3 | 500/500 | 0% | 538 ms | 840 ms | 871 ms | 875 ms | 984 ms |

Live screen (coordinator polling a roster of 500): p50 2 ms, p95 11 ms.

Control (GET /health (no auth, no database), 500 concurrent): p95 330 / 308 / 447 ms over 3 runs.

Realistic spread: 500 check-ins arriving at random moments over 60 s (8.3/s, the brief's 500 in 5 minutes is 1.7/s): 500/500 succeeded, p50 3 ms, p95 8 ms, p99 14 ms, max 29 ms.
