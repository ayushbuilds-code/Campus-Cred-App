# CampusCred

One platform to run every MSOT club, from enrolment to a verified certificate.
Mobile-first web app (installable), Node.js API, React front end.

Seeded with the real starting point: **4 clubs (Entrepreneurship, Sports, Coding, Cultural), 10 members each**
(1 President, 1 Vice President, 1 Treasurer, 7 members), 48 students in total, six Saturdays of Club Days, one finished event (Gambade), and two upcoming events.

## Start it (one command)

Requires Node.js 20 or newer.

```bash
npm run quickstart      # installs, loads demo data, builds the web app, starts on http://localhost:4000
```

Next time just `npm start`. For development with hot reload: `npm run dev` (web on :5173, API on :4000).
Reset the demo data at any time: `npm run seed -- --reset` (then restart the server).

**Demo accounts.** The login screen lists them; tap one to sign in. Password for every demo account: `Demo@123`.

| Role | Account | Try this |
|---|---|---|
| Admin | `admin@msot.example` | create clubs, import Club Days, dashboards, audit log, settings |
| Campus manager | `manager@msot.example` | approve clubs, create events, enter results, approve duty leave |
| Faculty advisor | `advisor.coding@msot.example` (also `.entrepreneurship`, `.sports`, `.cultural`) | approve plans, evaluate, issue achievement certificates, budget decisions |
| Student coordinator | `siddharth.nair.21@students.msot.example` (Coding President) | plan, **run check-in**, correct attendance, score, publish |
| Treasurer | `manav.khan.23@students.msot.example` (Coding) | budget requests |
| Student | student ID `MSOT26025` (Coding member) | check in, submit, certificates, transcript |
| New student (no club) | student ID `MSOT26045` | browse and request to join |

## The 5-minute tour

1. Sign in as the **Coding President**. Home shows "Run today's Club Day". Open it, tap **Start check-in**. A full-screen QR appears with a 6-digit code. Both change every 20 seconds.
2. On a phone (or a second browser window) sign in as **MSOT26025**, tap **Check in now**, enter the code. The president's screen counts up live.
3. As the student, open the activity and submit a link. As the president, score it and tap **Publish scores**. A participation certificate is issued automatically.
4. Student: **Certificates**, download the PDF, open its verification link in a private window (no login). Upload an edited copy of the PDF and watch it get rejected.
5. Admin: **Dashboard**, **Reports**, **Admin, Audit log** (the attendance correction and score change you just made are in there).

A fuller script is in `docs/DEMO_SCRIPT.md`.

## What is built, mapped to the brief

| Brief requirement | Where it lives |
|---|---|
| 1. Club registry (per campus, advisor, coordinators, capacity, meeting rules) | Clubs page, club Settings tab, `routes/clubs.js`. New clubs start "pending" until the campus manager approves. |
| 2. Student enrolment with limits, coordinator approval | Clubs, "Request to join", Join requests tab. Limit (default 1 primary + 1 secondary) and capacity are enforced by the API and configurable under Admin. |
| 3. Club Day calendar, activity plans, advisor approval | Club Days page, activity page, `routes/days.js`. CSV import of the academic calendar. States: draft, waiting for advisor, approved, changes requested. |
| 4. Attendance check-in (QR or code, correction with reason) | Run screen (`/run/:id`), Check in page. Rotating server-signed QR, 6-digit code, late flag, optional location check. Corrections need a reason and are audit-logged. |
| 5. Submissions with deadlines | Activity page. PDF/PPT/DOC/PNG/JPG/ZIP up to 10 MB, or a link. Resubmit until the deadline. |
| 6. Evaluation on a rubric | Score dialog: content, presentation, participation (weights configurable), comment. Scores stay hidden until published. |
| 7. Events, registrations, teams, check-in, results | Events pages, `routes/events.js`. Invite-code teams, capacity, event check-in with the same rotating QR, results and certificates. |
| 8. Certificates with verification link / QR | PDF with QR, unique ID, SHA-256 fingerprint. Public page `/verify/:id`, plus "upload a PDF to check it". |
| 9. Dashboards and exportable reports | Dashboard (participation by club and campus, inactive clubs, zero-participation students, top contributors), Reports (monthly, CSV), student export CSV. |
| Stretch: transcript for the Placement Copilot | Transcript page + verified PDF; JSON at `GET /api/v1/students/:id/transcript` is the "Achievements" input. |
| Stretch: budget requests | Treasurer requests, advisor approves. |
| Stretch: duty leave | Created automatically when a student registers for an inter-college event; campus manager approves. |
| Stretch: announcements | Club announcements to members (in-app; e-mail is queued in an outbox table). |
| Stretch: photo gallery with consent | **Not built.** |
| Stretch: WhatsApp / Telegram | **Not built.** Notifications are written to `outbox` so a sender can be attached. |

### The Club Day timeline is automated

A scheduler runs every minute: plan reminders to coordinators 7 days before; member announcement 3 days before (topic, venue, deliverable, deadline; sent immediately if a plan is approved inside that window);
submission reminder 24 hours before a deadline to attendees who have not submitted; monthly report to the campus manager on the last day of the month (and a catch-up for the previous month).
Admin, Rules and settings, "Run scheduled jobs now" triggers it on demand. Check-in windows, late threshold, deadline defaults and rubric weights are configurable.

### How check-in resists cheating

* The QR holds a token signed with a per-session secret and the current 20-second time slot. A token is accepted for its own slot and the one before, so a screenshot works for at most 20 to 40 seconds.
* The 6-digit code is derived the same way and is only matched against sessions the student is eligible for.
* Only active members of that club (or registered participants of that event) can check in; one check-in per student per session (database unique constraint).
* Late arrivals are marked "late" automatically. Location check is off / flag / block per session.
* A coordinator can correct any record, but the reason is mandatory and the old and new values are written to the audit log with their name. Students cannot touch attendance or scores at all.

### Roles

Permissions are decided in one place (`apps/api/src/lib/access.js`) and applied on the server for every request, never only in the UI. `system_role` (admin, campus manager, advisor, student) and `club_position` (President, VP, Treasurer, member) are separate fields. A President or Vice President is a coordinator for their own club only.

## Project layout

```
apps/api/      Express API (JavaScript, ES modules) + SQLite (better-sqlite3)
  src/routes/  auth, clubs, days (calendar, plans, check-in), work (submissions, scoring), events, certs, insights, misc
  src/lib/     access rules, rotating tokens, PDF certificates, statistics, scheduler jobs
  test/        33 integration tests
apps/web/      React + TypeScript + Vite + Tailwind (installable PWA manifest)
load-tests/    check-in load test and its latest results
e2e/           browser walkthrough (Playwright)
docs/          ARCHITECTURE.md, TEST_REPORT.md, DEMO_SCRIPT.md, screenshots
samples/       sample certificates and a sample transcript (PDF)
```

## Tests

```bash
npm test                 # 33 API tests: end-to-end Club Day x3 clubs, check-in abuse cases, 20 certificates + tamper test,
                         # 200 concurrent registrations with teams, permissions, report figures vs raw data, automation
npm run load-test        # 100 / 300 / 500 simultaneous check-ins, p95 and error rate (takes about 2 minutes)
python3 e2e/walkthrough.py   # real-browser walkthrough (pip install playwright && playwright install chromium)
node scripts/test-report.mjs # rebuild docs/TEST_REPORT.md from the last runs
```

Results and commentary: `docs/TEST_REPORT.md`.

## Configuration

See `.env.example`. The important ones: `JWT_SECRET` (required in production), `PUBLIC_URL` (certificate QR codes point here), `ROTATE_SECONDS`, `DEMO_MODE=0` to hide demo accounts and the on-screen OTP.

## Honest limitations (read before relying on it)

* **Database is SQLite, not Postgres/Supabase.** It gives one-command setup and handled the load test, but it is a single-writer file database. The schema is plain SQL and lives in one file (`apps/api/src/schema.js`). Moving to Postgres means porting the data-access calls from synchronous (`better-sqlite3`) to async (`pg`); that is real work, not a config change. Because permissions live in the API, Postgres Row Level Security is not used.
* **Login:** email/student-ID + password and a student OTP. Google Workspace login for staff is **not implemented**. The OTP is shown on screen in demo mode and there is no SMS/e-mail sender.
* **Notifications:** in-app alerts work. E-mail messages are queued in the `outbox` table (visible under Admin) but nothing sends them. No WhatsApp/Telegram.
* **PWA:** the app is installable (manifest + icon) but has no offline service worker. Check-in needs a connection by design.
* **Load test:** 500 check-ins at the same instant measured 0.84 to 0.99 s p95 in the final run on a 1-vCPU machine that was also running the load generator (1.0 to 1.2 s before tuning). That is a thin margin and varies run to run; 100 and 300 simultaneous are comfortably under 0.7 s, and 500 arriving at a realistic pace (8 per second, five times the brief's rate) is about 8 ms p95. Exact figures: `docs/TEST_REPORT.md`.
* **Untested:** in-app camera scanning on a real device, real phone geolocation, the Dockerfile, deployment to a host, a formal accessibility audit.
* **Time zone:** deadlines default to 11:59 pm IST and times display in IST.
* Uploaded files are type- and size-checked but not virus-scanned.
* Production checklist: set `JWT_SECRET`, `DEMO_MODE=0`, serve over HTTPS (browsers require it for camera and location), back up `apps/api/data`.
