# CampusCred

> **The Co-Curricular Operating System for Modern Universities**  
> One unified platform to run university clubs, verify attendance, evaluate student deliverables, and issue cryptographically verifiable certificates.

[![Live Production](https://img.shields.io/badge/Render-Live%20Deploy-success?style=flat-square&logo=render)](https://campuscred-gd43.onrender.com)
[![Node.js Version](https://img.shields.io/badge/Node.js-20%20LTS-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com)
[![Tests](https://img.shields.io/badge/Tests-33%20Passing-success?style=flat-square)](docs/TEST_REPORT.md)

---

## 🌐 Live Application

- **Production URL**: [campuscred-gd43.onrender.com](https://campuscred-gd43.onrender.com)
- **Deployment Platform**: Render Web Service (`srv-dbblp68473hc73cpjf6g`) via Infrastructure-as-Code (`render.yaml`)
- **PWA Ready**: Installable Progressive Web App with dedicated web manifest and brand icons

---

## 🚀 Key Highlights & Current Features

- **Multi-Campus Architecture**: Supports independent campuses with localized governance, campus admins, and multi-campus reporting:
  - **Bengaluru**: Mirai School of Technology (`BLR`)
  - **Mumbai**: Apex University of Science & Arts (`MUM`)
  - **Delhi NCR**: Delhi Metropolitan College (`DEL`)
- **Anti-Cheating Check-In**: Rotating dynamic QR code and synchronized 6-digit one-time code generated from per-session secrets and 20-second time slots. Includes optional geo-radius validation.
- **Academic Club Days Workflow**:
  - Semester calendar import (CSV or UI)
  - 4-stage activity lifecycle: Draft ➔ Waiting for Advisor ➔ Approved / Changes Requested ➔ Published
  - Automated cron scheduler sending reminder triggers 7 days, 3 days, and 24 hours prior to deadlines
- **Deliverables & Rubric Scoring**:
  - File submissions (PDF, PPT, DOC, images, ZIP up to 10 MB) or external repository/portfolio links
  - Multi-criteria weighted rubrics (Content, Presentation, Participation)
- **Verifiable PDF Certificates**:
  - High-res automated certificates stamped with unique ID, SHA-256 fingerprint, and verification QR code
  - Public verification portal (`/verify/:id`) with live document upload tamper-detection
- **Placement Copilot Integration**:
  - Exportable verified Student Co-Curricular Transcripts (PDF)
  - Machine-readable JSON API (`GET /api/v1/students/:id/transcript`) tailored for placement platforms
- **Events & Inter-College Meets**:
  - Team creation with invite codes, capacity limits, and real-time attendance
  - Automatic **Duty Leave** generation and campus manager approval pipeline
- **Treasury & Budget Management**:
  - Student Treasurer budget requests with receipts, advisor approvals, and campus-wide expense tracking
- **Enterprise UI Design**:
  - Official CampusCred visual brand identity and high-resolution logo (`/logo.jpg`)
  - Custom Lucide SVG iconography across all views (zero raw emojis)
  - Strict role-based routing and permissions enforced securely on the API level

---

## ⚡ Quick Start (Local Setup)

Requires **Node.js 20 LTS** or newer.

### 1. One-Command Setup
```bash
# Clone the repository
git clone https://github.com/ayushbuilds-code/CampusCred.git
cd CampusCred

# Install dependencies, seed database, build frontend, and start API
npm run quickstart
```
The server will start on `http://localhost:4000`.

### 2. Development Mode (Hot Reload)
To run the Vite frontend and Express API concurrently with live reload:
```bash
npm run dev
```
- **Web App**: `http://localhost:5173` (proxied to API)
- **API Server**: `http://localhost:4000`

### 3. Resetting Seed Data
To purge the database and reset to pristine demo state:
```bash
npm run seed -- --reset
```

---

## 🔑 Demo Credentials

All seeded demo accounts use the standard password: `@Demo123`

| Role | Account Email / ID | Campus / Affiliation | What to Explore |
|---|---|---|---|
| **Super Admin** | `superadmin@msot.com` | Global (All Campuses) | Global overview, campus management, audit logs, system-wide rules |
| **Campus Admin (Bengaluru)** | `campus.admin@msot.com` | Mirai School of Tech | Club approvals, duty leave, campus reports, calendar imports |
| **Faculty Advisor** | `aditya@msot.com` | Sport Club (BLR) | Review activity plans, rubric score submissions, approve budgets |
| **Sport Club President** | `astitva@msot.com` | Sport Club (BLR) | Launch dynamic rotating QR check-in, score members, publish grades |
| **Sport Club Treasurer** | `aryan@msot.com` | Sport Club (BLR) | Submit budget requests and track expenses |
| **Active Member** | `ayush@msot.com` / `MSOT26003` | Sport Club (BLR) | Mobile QR scan / 6-digit check-in, submit project link, download certificates |

---

## 📋 Comprehensive Feature Map

| Capability | Module & Implementation |
|---|---|
| **Multi-Campus Club Registry** | `apps/web/src/pages/Clubs.tsx`, `apps/api/src/routes/clubs.js`<br>Campus scoped, advisor assignments, coordinator rosters, meeting schedules, and capacity limits. |
| **Enrolment & Quotas** | Strict limit enforcement (default: 1 Primary + 1 Secondary club). Coordinator review workflows. |
| **Club Day Schedules & Approvals** | `apps/api/src/routes/days.js`<br>Semester timeline, activity syllabus, advisor revision requests, and public schedule view. |
| **Anti-Cheating Attendance** | `apps/web/src/pages/RunDay.tsx`, `apps/web/src/pages/CheckIn.tsx`<br>Cryptographic HMAC-signed tokens rotating every 20 seconds. 6-digit numeric fallback. Geofence radius support. Reason-required coordinator audit logging. |
| **Deliverables & Evaluation** | `apps/web/src/pages/DayDetail.tsx`, `apps/api/src/routes/work.js`<br>File upload (10 MB limit) or URL submission. Weighted rubric scoring. Draft/Published score privacy. |
| **Events & Duty Leave** | `apps/web/src/pages/Events.tsx`, `apps/api/src/routes/events.js`<br>Inter-college competitions, team invite codes, duty leave generation for campus admin approval. |
| **Verifiable Credentials** | `apps/api/src/lib/certs.js`, `apps/web/src/pages/Certificates.tsx`<br>Vector PDF generation via `pdfkit` with embedded QR and SHA-256 digital fingerprint. Public validation route at `/verify/:id`. |
| **Placement Co-Curricular Transcript** | `apps/web/src/pages/Transcript.tsx`<br>Official academic co-curricular transcript PDF and REST API (`GET /api/v1/students/:id/transcript`). |
| **Budget & Financial Ledger** | `apps/web/src/pages/Budget.tsx`<br>Treasurer expense proposals, proof receipt uploads, and faculty advisor approval states. |
| **Automated Scheduler** | `apps/api/src/lib/jobs.js`<br>Background cron triggers for submission deadlines, coordinator notifications, and monthly director summaries. |
| **Audit Trails & Security** | `apps/api/src/lib/access.js`<br>Immutable audit log recording attendance modifications, score updates, and permission changes with user attribution. |

---

## 🏗️ Architecture & Project Structure

The project is structured as a clean, modular npm workspaces monorepo:

```
CampusCred/
├── apps/
│   ├── api/                      # Backend API service
│   │   ├── data/                 # SQLite database storage (campuscred.db)
│   │   ├── src/
│   │   │   ├── lib/              # Core business logic:
│   │   │   │   ├── access.js     # Unified role-based access control (RBAC)
│   │   │   │   ├── certs.js      # PDF certificate generation & SHA-256 hashing
│   │   │   │   ├── jobs.js       # Automated reminder & reporting scheduler
│   │   │   │   ├── tokens.js     # Rotating OTP & QR signature engine
│   │   │   │   └── util.js       # Shared helpers
│   │   │   ├── routes/           # REST endpoints: auth, clubs, days, work, events, certs
│   │   │   ├── schema.js         # Relational database schema (SQLite / DDL)
│   │   │   ├── seed-data.js      # Multi-campus demo seed dataset
│   │   │   └── server.js         # Express app entrypoint & middleware
│   │   └── test/                 # 33 comprehensive API & security tests
│   └── web/                      # Frontend Single Page Application (PWA)
│       ├── public/               # Static assets, logo.jpg, favicon, manifest.webmanifest
│       └── src/
│           ├── components/       # Reusable UI primitives, Navigation, Layout, SVG Icons
│           ├── lib/              # API client, Auth Context, formatting utilities
│           └── pages/            # View components (Dashboard, Clubs, Events, RunDay, etc.)
├── docs/                         # System architecture, test evidence, demo walkthrough scripts
├── load-tests/                   # High-concurrency check-in load testing suite
└── render.yaml                   # Render Blueprint Infrastructure-as-Code specification
```

---

## 🧪 Testing & Quality Assurance

CampusCred includes comprehensive automated test suites covering end-to-end user journeys, check-in abuse prevention, load limits, and document tamper verification.

### Run Integration Tests
```bash
npm test
```
- **33 Integration Tests**: Validates full Club Day cycles, score publishing, multi-campus permissions, certificate fingerprint verification, and concurrency locks.

### Run Attendance Stress / Load Test
```bash
npm run load-test
```
- Tests 100, 300, and 500 concurrent attendance check-in requests against the rotating cryptographic token endpoint.

---

## ⚙️ Configuration & Environment Variables

| Variable | Description | Default | Production Recommended |
|---|---|---|---|
| `PORT` | HTTP port for backend API | `4000` | Set by host (e.g. `10000` on Render) |
| `NODE_ENV` | Environment mode | `development` | `production` |
| `JWT_SECRET` | Secret key for signing session tokens | System fallback | Provide a secure 64-char string |
| `PUBLIC_URL` | Base URL embedded in certificate verification QRs | `http://localhost:4000` | `https://campuscred-gd43.onrender.com` |
| `ROTATE_SECONDS`| Frequency of attendance QR token rotation | `20` | `20` |
| `DEMO_MODE` | Exposes demo helper credentials | `1` | `0` for strict production environments |

---

## 🔒 Security Design

1. **Server-Side Enforcement**: Permissions are computed in `apps/api/src/lib/access.js` and validated per API route. The frontend only displays permitted controls.
2. **Rotating Attendance Secrets**: Single-use time slots prevent screenshot sharing or attendance proxying.
3. **Cryptographic Certificate Verification**: Every certificate generates a canonical payload hashed with SHA-256. Re-uploading a modified PDF detects any pixel or byte alteration immediately.
4. **Audit Logging**: Any coordinator or admin override of attendance or marks requires a mandatory justification and records the actor's ID, timestamp, and previous state.

---

## 📄 License

Proprietary — Built for modern university campus co-curricular operations.
