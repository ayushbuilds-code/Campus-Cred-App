import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS campuses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  city TEXT,
  state TEXT,
  lat REAL,
  lng REAL,
  radius_m INTEGER NOT NULL DEFAULT 500,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  campus_id INTEGER REFERENCES campuses(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  student_code TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  system_role TEXT NOT NULL CHECK (system_role IN ('super_admin','admin','campus_admin','campus_manager','faculty_advisor','advisor','student')),
  phone TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  meeting_rules TEXT,
  advisor_id INTEGER REFERENCES users(id),
  capacity INTEGER NOT NULL DEFAULT 10 CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','archived')),
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (campus_id, name)
);

CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  position TEXT NOT NULL DEFAULT 'member' CHECK (position IN ('president','vice_president','treasurer','member')),
  is_primary INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','left')),
  note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (club_id, user_id)
);

CREATE TABLE IF NOT EXISTS faculty_advisor_assignments (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  UNIQUE (club_id, user_id)
);

-- Exactly one President / Vice President / Treasurer per club (database-enforced).
CREATE UNIQUE INDEX IF NOT EXISTS one_leader_per_position ON memberships(club_id, position)
  WHERE status = 'active' AND position IN ('president','vice_president','treasurer');
CREATE INDEX IF NOT EXISTS idx_mem_user ON memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_mem_club ON memberships(club_id, status);

CREATE TABLE IF NOT EXISTS club_days (
  id INTEGER PRIMARY KEY,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  date TEXT NOT NULL,
  title TEXT,
  venue TEXT,
  UNIQUE (campus_id, date)
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  club_day_id INTEGER NOT NULL REFERENCES club_days(id),
  topic TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('ppt','assignment','on_the_spot')),
  deliverable TEXT,
  venue TEXT,
  submission_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','changes_requested')),
  advisor_comment TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE (club_id, club_day_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  campus_id INTEGER REFERENCES campuses(id), -- NULL = inter-campus
  club_id INTEGER REFERENCES clubs(id),
  name TEXT NOT NULL,
  kind TEXT,
  description TEXT,
  venue TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  registration_deadline TEXT,
  capacity INTEGER NOT NULL DEFAULT 200,
  team_size_min INTEGER NOT NULL DEFAULT 1,
  team_size_max INTEGER NOT NULL DEFAULT 1,
  inter_college INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','completed')),
  created_by INTEGER REFERENCES users(id),
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('club_day','event')),
  activity_id INTEGER REFERENCES activities(id),
  event_id INTEGER REFERENCES events(id),
  club_id INTEGER REFERENCES clubs(id),
  opened_by INTEGER REFERENCES users(id),
  opened_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  late_after TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  secret TEXT NOT NULL,
  geo_lat REAL,
  geo_lng REAL,
  geo_radius_m INTEGER,
  geo_mode TEXT NOT NULL DEFAULT 'off' CHECK (geo_mode IN ('off','flag','block'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_session_per_activity ON sessions(activity_id) WHERE activity_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_session_per_event ON sessions(event_id) WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('present','late','absent')),
  method TEXT NOT NULL CHECK (method IN ('qr','code','manual')),
  checked_at TEXT NOT NULL,
  distance_m INTEGER,
  flag TEXT,
  corrected_by INTEGER REFERENCES users(id),
  correction_reason TEXT,
  UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('file','link')),
  file_path TEXT,
  original_name TEXT,
  link_url TEXT,
  note TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE (activity_id, user_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL UNIQUE REFERENCES submissions(id),
  evaluator_id INTEGER NOT NULL REFERENCES users(id),
  content INTEGER NOT NULL,
  presentation INTEGER NOT NULL,
  participation INTEGER NOT NULL,
  total REAL NOT NULL,
  comment TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  leader_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (event_id, name)
);

CREATE TABLE IF NOT EXISTS event_regs (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  team_id INTEGER REFERENCES teams(id),
  registered_at TEXT NOT NULL,
  result_position INTEGER,
  result_note TEXT,
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_regs_event ON event_regs(event_id);
CREATE INDEX IF NOT EXISTS idx_regs_user ON event_regs(user_id);
CREATE INDEX IF NOT EXISTS idx_att_user ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_act ON submissions(activity_id);
CREATE INDEX IF NOT EXISTS idx_act_club ON activities(club_id, club_day_id);

CREATE TABLE IF NOT EXISTS duty_leaves (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER REFERENCES users(id),
  decision_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  club_id INTEGER REFERENCES clubs(id),
  event_id INTEGER REFERENCES events(id),
  kind TEXT NOT NULL CHECK (kind IN ('participation','achievement','transcript')),
  title TEXT NOT NULL,
  detail TEXT,
  ref_key TEXT,
  issued_by INTEGER REFERENCES users(id),
  issued_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','revoked')),
  revoked_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_cert_per_ref ON certificates(user_id, kind, ref_key) WHERE ref_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cert_user ON certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_cert_filehash ON certificates(file_hash);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'email',
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_requests (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  category TEXT DEFAULT 'Equipment',
  amount_inr INTEGER NOT NULL CHECK (amount_inr > 0),
  purpose TEXT,
  items_json TEXT,
  sheet_link TEXT,
  supporting_docs TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
    'Draft','Submitted to Advisor','Advisor Changes Requested','Advisor Approved','Sent to College','College Approved','College Rejected',
    'draft','submitted_advisor','changes_requested','advisor_approved','sent_to_college','college_approved','college_rejected',
    'pending','pending_president','pending_admin','approved','rejected'
  )),
  advisor_feedback TEXT,
  college_feedback TEXT,
  president_decided_by INTEGER REFERENCES users(id),
  president_decision_note TEXT,
  president_decided_at TEXT,
  decided_by INTEGER REFERENCES users(id),
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_budget_club ON budget_requests(club_id);
CREATE INDEX IF NOT EXISTS idx_budget_req_user ON budget_requests(requested_by);

CREATE TABLE IF NOT EXISTS budget_approvals (
  id INTEGER PRIMARY KEY,
  budget_request_id INTEGER NOT NULL REFERENCES budget_requests(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  stage TEXT NOT NULL, -- 'treasurer', 'faculty_advisor', 'college_admin', 'super_admin'
  action TEXT NOT NULL, -- 'submit', 'approve', 'reject', 'request_changes', 'forward'
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_approvals_req ON budget_approvals(budget_request_id);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  club_id INTEGER REFERENCES clubs(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES users(id),
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_campus ON announcements(campus_id);
CREATE INDEX IF NOT EXISTS idx_announcements_club ON announcements(club_id);

CREATE TABLE IF NOT EXISTS activity_leaves (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  club_day_id INTEGER REFERENCES club_days(id),
  activity_id INTEGER REFERENCES activities(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER REFERENCES users(id),
  decision_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_act_leave_user ON activity_leaves(user_id);
CREATE INDEX IF NOT EXISTS idx_act_leave_club ON activity_leaves(club_id);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reminders (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS monthly_reports (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  month TEXT NOT NULL,
  payload TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  UNIQUE (club_id, month)
);
`;

export const DEFAULT_SETTINGS = {
  max_clubs_per_student: 3,
  checkin_window_minutes: 15,
  late_after_minutes: 10,
  geo_mode: 'flag',
  rubric_weights: { content: 40, presentation: 30, participation: 30 },
  inactive_days: 30,
  max_upload_mb: 10,
};

export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Cache prepared statements to prevent GC destructor assertion in Node 24 and improve query speed
  const origPrepare = db.prepare.bind(db);
  const stmtCache = new Map();
  db.prepare = (sql) => {
    let s = stmtCache.get(sql);
    if (!s) {
      s = origPrepare(sql);
      stmtCache.set(sql, s);
    }
    return s;
  };

  db.exec(SCHEMA);

  // Column migrations for existing databases
  const addCol = (tbl, col, type) => {
    try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${type}`); } catch {}
  };
  addCol('campuses', 'code', 'TEXT');
  addCol('campuses', 'state', 'TEXT');
  addCol('campuses', 'created_at', 'TEXT');

  addCol('budget_requests', 'category', "TEXT DEFAULT 'Equipment'");
  addCol('budget_requests', 'supporting_docs', 'TEXT');
  addCol('budget_requests', 'notes', 'TEXT');
  addCol('budget_requests', 'advisor_feedback', 'TEXT');
  addCol('budget_requests', 'college_feedback', 'TEXT');
  addCol('budget_requests', 'updated_at', 'TEXT');
  addCol('budget_requests', 'items_json', 'TEXT');
  addCol('budget_requests', 'sheet_link', 'TEXT');
  addCol('budget_requests', 'president_decided_by', 'INTEGER REFERENCES users(id)');
  addCol('budget_requests', 'president_decision_note', 'TEXT');
  addCol('budget_requests', 'president_decided_at', 'TEXT');

  addCol('events', 'club_id', 'INTEGER REFERENCES clubs(id)');

  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, JSON.stringify(v));
  return db;
}
