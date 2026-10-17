# CampusCred Test Report

Generated 2026-10-12 by `scripts/test-report.mjs` from the raw outputs of the test runs listed below. Nothing in this file is typed in by hand except the commentary.

## Summary

| Suite | How to run | Result |
|---|---|---|
| API integration tests (real HTTP, in-memory SQLite, injectable clock) | `npm test` | **34 of 34 passed**, 0 failed |
| Browser walkthrough (Chromium via Playwright, desktop and 390 px phone profile) | `python3 e2e/walkthrough.py` | **17 of 17 checks passed**, 0 console errors |
| Load test (separate server process, file-based SQLite) | `npm run load-test` | see "Load test" below |

## Results against the brief's test requirements

### End-to-end Club Day (3 clubs)

*Required evidence:* Full flow for 3 clubs: plan, approve, check-in, submit, evaluate, report

| What was tested | Outcome |
|---|---|
| ent: plan > advisor approve > check-in (7/10) > 5 submissions > scored > published > 5 certificates > report row correct | pass |
| coding: plan > advisor approve > check-in (7/10) > 5 submissions > scored > published > 5 certificates > report row correct | pass |
| cultural: plan > advisor approve > check-in (7/10) > 5 submissions > scored > published > 5 certificates > report row correct | pass |

### Check-in integrity

*Required evidence:* Screenshot sharing, late check-in, check-in from outside campus: what happens in each case

| What was tested | Outcome |
|---|---|
| Screenshot of a QR shared and used 61 s later | 410 "QR has expired", no attendance recorded |
| Forged / edited token | 400 "QR code is not valid" |
| Student from another club scans a valid QR | 403 "Only members of this club can check in" |
| Check-in from outside campus (geo block mode) / location not shared | 403, nothing recorded |
| Duplicate check-in / 6-digit code / wrong code / late arrival | 409 / 201 / 410 / recorded as "late" and flagged |
| Outside campus in "flag" mode | 201 recorded with flag "Outside campus (xx m away)" for the coordinator to review |
| Attendance correction by coordinator | Reason mandatory (400 without), audit log stores who / old / new / reason; student attempt 403 |
| Check-in opened 2 days after the Club Day (late or rescheduled session) | student sees the open check-in on Home; check-in succeeds |

### Certificates

*Required evidence:* 20 certificates generated; each verification link opens the correct record; tampered PDF fails verification

| What was tested | Outcome |
|---|---|
| 20 certificates verified by public link (holder, status, record hash recomputed, valid PDF) | 20/20 pass; unknown ID returns 404 |
| Original PDF vs the same PDF with one byte changed | original: match; tampered: rejected ("altered") |
| Achievement certificate issue then revoke | verification page shows "revoked" |
| JSON + PDF transcript, repeat download returns the same verified file, other students blocked | pass |

### Events

*Required evidence:* Event with 200 registrations and team formation runs without duplicates or lost entries

| What was tested | Outcome |
|---|---|
| 200 registrations, 50 teams x 4 formed concurrently (50 creates + 150 joins at once) | 200 rows, 200 distinct students, 0 duplicates, 0 without team; 201st registration and 5th team member rejected; 6 simultaneous double-taps create 1 row |
| Results entry, certificates, inter-college duty leave approval | pass |

### Permissions

*Required evidence:* Coordinators see only their own club; students cannot edit attendance or scores

| What was tested | Outcome |
|---|---|
| 15 forbidden actions (cross-club coordinator access, student edits to attendance / scores / clubs / dashboards) | all 15 return 403 |
| Student lists submissions: only own row, unpublished score hidden | pass |
| .exe rejected, PDF accepted, other club cannot download, submission after deadline rejected | pass |

### Reports

*Required evidence:* Monthly report figures match the raw attendance and submission data

| What was tested | Outcome |
|---|---|
| Monthly report 2026-09: held, check-ins, submissions, attendance %, average score for 4 clubs recomputed independently from raw rows | all values equal |
| Monthly report 2026-10: held, check-ins, submissions, attendance %, average score for 4 clubs recomputed independently from raw rows | all values equal |
| Overview totals, top contributors ordering, zero-participation list equals raw query; coordinator sees only own club | pass |

### Also covered

*Required evidence:* Seed data, enrolment rules and automation

| What was tested | Outcome |
|---|---|
| 4 clubs x 10 members (1 President, 1 VP, 1 Treasurer, 7 members) | pass |
| Second President in one club is rejected by a database constraint | pass |
| Join request, coordinator approval, club limit (2), capacity (full club blocks joins) | pass |
| 3-day announcement sent once with topic, venue, deliverable and deadline; plan-due reminders; month-end report generator | pass |

## Load test: check-in endpoint

**Machine:** 1 vCPU (Intel(R) Xeon(R) Processor @ 2.80GHz), Node v22.22.2. **Database:** SQLite (WAL) on local disk, single API process. The load generator ran on the *same* machine as the server, so both competed for the same CPU.

Each trial fires N check-ins **at the same instant** (every student a different user, each presenting a valid rotating QR token) over real HTTP. This is much harsher than the brief's "500 within 5 minutes" (about 1.7 requests per second).

| Concurrent check-ins | Trial | Succeeded | Error rate | p50 | p95 | p99 | Max |
|---|---|---|---|---|---|---|---|
| 100 | 1 | 100/100 | 0% | 189 ms | 246 ms | 256 ms | 257 ms |
| 100 | 2 | 100/100 | 0% | 134 ms | 210 ms | 215 ms | 219 ms |
| 100 | 3 | 100/100 | 0% | 151 ms | 256 ms | 263 ms | 268 ms |
| 300 | 1 | 300/300 | 0% | 460 ms | 678 ms | 693 ms | 697 ms |
| 300 | 2 | 300/300 | 0% | 426 ms | 566 ms | 575 ms | 578 ms |
| 300 | 3 | 300/300 | 0% | 368 ms | 507 ms | 520 ms | 523 ms |
| 500 | 1 | 500/500 | 0% | 612 ms | 991 ms | 1017 ms | 1023 ms |
| 500 | 2 | 500/500 | 0% | 609 ms | 919 ms | 931 ms | 947 ms |
| 500 | 3 | 500/500 | 0% | 538 ms | 840 ms | 871 ms | 875 ms |

**p95 per level (all trials):** 100 concurrent: 246 / 210 / 256 ms; 300 concurrent: 678 / 566 / 507 ms; 500 concurrent: 991 / 919 / 840 ms.

**Reading the numbers honestly**

- 100 and 300 simultaneous check-ins are under the 1 second p95 target in every trial, with 0% errors and every row saved exactly once.
- 500 simultaneous check-ins: p95 was 991, 919, 840 ms. All trials were under 1 second. Zero errors and no lost or duplicate rows in any trial. The margin is thin: run-to-run variation on this shared machine is roughly 15%, and an earlier run of this same test, before the hot-path tuning (prebuilt JWT key, check-in route matched first, no per-response ETag hashing), measured 1.0 to 1.2 s p95 at 500.
- Control: the same 500 simultaneous requests to a trivial endpoint (`GET /health`, no auth, no database) had p95 330 / 308 / 447 ms, so roughly a third to a half of the latency is plain HTTP handling plus the load generator sharing the CPU, not check-in logic.
- Realistic arrival: 500 check-ins at random moments over 60 s (8.3/s, 5x the brief's rate): 500/500 succeeded, p50 3 ms, **p95 8 ms**, p99 14 ms.
- The coordinator's live screen polling a 500-student roster: p95 11 ms.
- Not measured: a real Postgres deployment, multiple server processes, or separate load-generator hardware. Expect better numbers with 2+ cores; this has not been verified.

## Browser walkthrough checks

| Check | Result |
|---|---|
| login page lists demo accounts | pass |
| wrong password shows a readable error | pass |
| president home shows "Club Days ready to run" | pass |
| clubs page lists 4 clubs (4) | pass |
| live screen shows a rotating QR and a 6-digit code (173782) | pass |
| student home shows check-in banner | pass |
| student checks in with the 6-digit code | pass |
| president live count updates to 1 / 10 | pass |
| student submits work | pass |
| coordinator scores and publishes; a certificate is issued | pass |
| public verification page works without login (CC-2026-7B8A4A56) | pass |
| certificate PDF downloads (6878 bytes) | pass |
| tampered PDF is rejected in the UI | pass |
| transcript PDF downloads | pass |
| advisor approves a pending plan | pass |
| dashboard renders charts | pass |
| no horizontal scrolling at 360 px on main pages ([]) | pass |

Screenshots from this run are in `docs/screenshots/`.

## Problems the tests found while building (all fixed)

1. Creating an event crashed with HTTP 500 because of a malformed SQL parameter (found by the 200-registration test).
2. A Club Day that happened yesterday, with approved plan and no check-in yet, was hidden under "past" in the calendar. Submissions are due 48 hours after, so recent days now stay visible (found by the browser walkthrough).
3. Several cosmetic problems (stamp text overflowing its ring, login panel layout) found by looking at the screenshots.

## What is NOT tested

- The in-app camera QR scanner was not exercised with a real camera (headless Chromium has none). The 6-digit code path, the QR token endpoint, and the "open the QR link with the phone's own camera app" path (which auto-submits the token) are tested.
- Browser geolocation on real phones. The distance logic and the block / flag / not-shared outcomes are tested with supplied coordinates.
- Real e-mail / WhatsApp / Telegram delivery (messages are queued in an outbox table; no sender is connected).
- Docker image, Postgres, deployment to a host.
- Accessibility audit with a screen reader (labels, focus rings and contrast were designed in, not formally audited).
