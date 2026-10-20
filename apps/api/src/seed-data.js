import bcrypt from 'bcryptjs';
import { iso } from './lib/util.js';
import { issueCertificate } from './lib/certs.js';
import { runScheduler } from './lib/jobs.js';

const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const day = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export async function seedDemo(ctx, { rounds = 8 } = {}) {
  const { db } = ctx;
  const rand = rng(2026);
  const nowMs = ctx.now();
  const t0 = iso(nowMs);
  const today = t0.slice(0, 10);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const sat0 = day(today, -((dow + 1) % 7));
  const hash = bcrypt.hashSync('Demo@123', rounds);

  // =========================================================================
  // 1. CAMPUSES
  // =========================================================================
  const insCampus = db.prepare('INSERT INTO campuses(name,code,city,state,lat,lng,radius_m,created_at) VALUES (?,?,?,?,?,?,?,?)');

  const cBlr = insCampus.run('Mirai School of Technology', 'BLR', 'Bengaluru', 'Karnataka', 12.9716, 77.5946, 500, t0).lastInsertRowid;
  const cMum = insCampus.run('Apex University of Science & Arts', 'MUM', 'Mumbai', 'Maharashtra', 19.0760, 72.8777, 500, t0).lastInsertRowid;
  const cDel = insCampus.run('Delhi Metropolitan College', 'DEL', 'Delhi NCR', 'Delhi', 28.6139, 77.2090, 500, t0).lastInsertRowid;

  const insUser = db.prepare('INSERT INTO users(campus_id,name,email,student_code,password_hash,system_role,created_at) VALUES (?,?,?,?,?,?,?)');

  // =========================================================================
  // 2. SUPER ADMIN (Manages all campuses)
  // =========================================================================
  const superAdmin = insUser.run(null, 'Bittu Agarwal', 'superadmin@campus.edu', null, hash, 'super_admin', t0).lastInsertRowid;
  // Legacy admin alias for existing test compatibility
  const legacyAdmin = insUser.run(cBlr, 'Program Manager', 'admin@msot.example', null, hash, 'super_admin', t0).lastInsertRowid;

  // =========================================================================
  // 3. CAMPUS ADMINS (One for each campus)
  // =========================================================================
  const adminBlr = insUser.run(cBlr, 'Priya Nair (Campus Admin)', 'admin.bengaluru@msot.example', null, hash, 'campus_admin', t0).lastInsertRowid;
  // Legacy manager alias
  const legacyManager = insUser.run(cBlr, 'Campus Manager', 'manager@msot.example', null, hash, 'campus_admin', t0).lastInsertRowid;
  const adminMum = insUser.run(cMum, 'Vikram Deshmukh (Campus Admin)', 'admin.mumbai@apex.example', null, hash, 'campus_admin', t0).lastInsertRowid;
  const adminDel = insUser.run(cDel, 'Sunita Verma (Campus Admin)', 'admin.delhi@dmc.example', null, hash, 'campus_admin', t0).lastInsertRowid;

  // =========================================================================
  // 4. FACULTY ADVISORS & CLUBS PER CAMPUS
  // =========================================================================

  const insClub = db.prepare(`INSERT INTO clubs(campus_id,name,category,description,meeting_rules,advisor_id,capacity,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const insMem = db.prepare(`INSERT INTO memberships(club_id,user_id,position,is_primary,status,created_at,decided_at)
    VALUES (?,?,?,1,'active',?,?)`);
  const insAdvisorAssign = db.prepare('INSERT INTO faculty_advisor_assignments(club_id,user_id,assigned_by,assigned_at) VALUES (?,?,?,?)');

  // --- Campus 1: Bengaluru (MSOT) ---
  const advBlr1 = insUser.run(cBlr, 'Dr. Kavya Rao (Faculty Advisor)', 'advisor.coding@msot.example', null, hash, 'faculty_advisor', t0).lastInsertRowid;
  const advBlr2 = insUser.run(cBlr, 'Dr. Meera Iyer (Faculty Advisor)', 'advisor.ecell@msot.example', null, hash, 'faculty_advisor', t0).lastInsertRowid;
  const advBlr3 = insUser.run(cBlr, 'Prof. Vihaan Patel (Faculty Advisor)', 'advisor.robotics@msot.example', null, hash, 'faculty_advisor', t0).lastInsertRowid;

  const clubBlr1 = insClub.run(cBlr, 'Coding Club', 'Technology', 'Competitive programming, open-source engineering, and AI hackathons.', 'Saturdays 14:00 - 16:00 in Lab 3.', advBlr1, 30, 'approved', t0).lastInsertRowid;
  const clubBlr2 = insClub.run(cBlr, 'Entrepreneurship Club', 'Business', 'Build, pitch, and validate startup ventures with industry mentors.', 'Saturdays 10:00 - 12:00 in Seminar Hall 1.', advBlr2, 25, 'approved', t0).lastInsertRowid;
  const clubBlr3 = insClub.run(cBlr, 'Robotics & Hardware Club', 'Engineering', 'Autonomous systems, drones, and IoT prototyping workshops.', 'Saturdays 16:00 - 18:00 in Maker Studio.', advBlr3, 20, 'approved', t0).lastInsertRowid;

  insAdvisorAssign.run(clubBlr1, advBlr1, adminBlr, t0);
  insAdvisorAssign.run(clubBlr2, advBlr2, adminBlr, t0);
  insAdvisorAssign.run(clubBlr3, advBlr3, adminBlr, t0);

  // --- Campus 2: Mumbai (Apex) ---
  const advMum1 = insUser.run(cMum, 'Prof. Rohan Gupta (Faculty Advisor)', 'advisor.film@apex.example', null, hash, 'faculty_advisor', t0).lastInsertRowid;
  const advMum2 = insUser.run(cMum, 'Dr. Ananya Sharma (Faculty Advisor)', 'advisor.finance@apex.example', null, hash, 'faculty_advisor', t0).lastInsertRowid;
  const advMum3 = insUser.run(cMum, 'Prof. Arjun Menon (Faculty Advisor)', 'advisor.sports@apex.example', null, hash, 'faculty_advisor', t0).lastInsertRowid;

  const clubMum1 = insClub.run(cMum, 'Film & Media Society', 'Media & Arts', 'Screenwriting, documentary filmmaking, cinematography, and campus cinema screenings.', 'Saturdays 15:00 - 17:30 in Media Studio A.', advMum1, 25, 'approved', t0).lastInsertRowid;
  const clubMum2 = insClub.run(cMum, 'Finance & Investment Club', 'Finance', 'Equity research, algorithmic trading simulations, and venture capital case studies.', 'Saturdays 11:00 - 13:00 in Room 402.', advMum2, 25, 'approved', t0).lastInsertRowid;
  const clubMum3 = insClub.run(cMum, 'Sports & Fitness League', 'Fitness', 'Campus leagues, cross-training tournaments, and sports analytics.', 'Saturdays 07:30 - 09:30 on the Sports Arena.', advMum3, 30, 'approved', t0).lastInsertRowid;

  insAdvisorAssign.run(clubMum1, advMum1, adminMum, t0);
  insAdvisorAssign.run(clubMum2, advMum2, adminMum, t0);
  insAdvisorAssign.run(clubMum3, advMum3, adminMum, t0);

  // --- Campus 3: Delhi (DMC) ---
  const advDel1 = insUser.run(cDel, 'Prof. Sana Qureshi (Faculty Advisor)', 'advisor.debate@dmc.example', null, hash, 'faculty_advisor', t0).lastInsertRowid;
  const advDel2 = insUser.run(cDel, 'Dr. Kabir Nair (Faculty Advisor)', 'advisor.cultural@dmc.example', null, hash, 'faculty_advisor', t0).lastInsertRowid;

  const clubDel1 = insClub.run(cDel, 'Debating & Parliamentary Society', 'Literary', 'Parliamentary debates, Model UN, policy analysis, and moot courts.', 'Saturdays 14:00 - 16:30 in Moot Court Room.', advDel1, 25, 'approved', t0).lastInsertRowid;
  const clubDel2 = insClub.run(cDel, 'Cultural & Arts Guild', 'Arts', 'Theatre, classical and contemporary dance, music ensemble, and cultural festivals.', 'Saturdays 16:00 - 18:30 in Main Auditorium.', advDel2, 35, 'approved', t0).lastInsertRowid;

  insAdvisorAssign.run(clubDel1, advDel1, adminDel, t0);
  insAdvisorAssign.run(clubDel2, advDel2, adminDel, t0);

  // =========================================================================
  // 5. CLUB TREASURERS & STUDENT ROSTERS
  // =========================================================================

  // Bengaluru Students
  const treasBlr1 = insUser.run(cBlr, 'Aarav Sharma (Club Treasurer)', 'treasurer.coding@msot.example', 'MSOT26001', hash, 'student', t0).lastInsertRowid;
  const presBlr1 = insUser.run(cBlr, 'Diya Iyer (President)', 'pres.coding@msot.example', 'MSOT26002', hash, 'student', t0).lastInsertRowid;
  const studBlr1 = insUser.run(cBlr, 'Rohan Verma (Member)', 'student.blr@msot.example', 'MSOT26003', hash, 'student', t0).lastInsertRowid;

  insMem.run(clubBlr1, presBlr1, 'president', t0, t0);
  insMem.run(clubBlr1, treasBlr1, 'treasurer', t0, t0);
  insMem.run(clubBlr1, studBlr1, 'member', t0, t0);

  const treasBlr2 = insUser.run(cBlr, 'Ishita Reddy (Club Treasurer)', 'treasurer.ecell@msot.example', 'MSOT26004', hash, 'student', t0).lastInsertRowid;
  const presBlr2 = insUser.run(cBlr, 'Arjun Das (President)', 'pres.ecell@msot.example', 'MSOT26005', hash, 'student', t0).lastInsertRowid;
  insMem.run(clubBlr2, presBlr2, 'president', t0, t0);
  insMem.run(clubBlr2, treasBlr2, 'treasurer', t0, t0);

  const treasBlr3 = insUser.run(cBlr, 'Dev Kulkarni (Club Treasurer)', 'treasurer.robotics@msot.example', 'MSOT26006', hash, 'student', t0).lastInsertRowid;
  insMem.run(clubBlr3, treasBlr3, 'treasurer', t0, t0);

  // Mumbai Students
  const treasMum1 = insUser.run(cMum, 'Tanvi Patel (Club Treasurer)', 'treasurer.film@apex.example', 'APEX26001', hash, 'student', t0).lastInsertRowid;
  const presMum1 = insUser.run(cMum, 'Karan Joshi (President)', 'pres.film@apex.example', 'APEX26002', hash, 'student', t0).lastInsertRowid;
  const studMum1 = insUser.run(cMum, 'Sara Khan (Member)', 'student.mum@apex.example', 'APEX26003', hash, 'student', t0).lastInsertRowid;

  insMem.run(clubMum1, presMum1, 'president', t0, t0);
  insMem.run(clubMum1, treasMum1, 'treasurer', t0, t0);
  insMem.run(clubMum1, studMum1, 'member', t0, t0);

  const treasMum2 = insUser.run(cMum, 'Rahul Bhat (Club Treasurer)', 'treasurer.finance@apex.example', 'APEX26004', hash, 'student', t0).lastInsertRowid;
  insMem.run(clubMum2, treasMum2, 'treasurer', t0, t0);

  // Delhi Students
  const treasDel1 = insUser.run(cDel, 'Nisha Singh (Club Treasurer)', 'treasurer.debate@dmc.example', 'DMC26001', hash, 'student', t0).lastInsertRowid;
  const presDel1 = insUser.run(cDel, 'Vihaan Rao (President)', 'pres.debate@dmc.example', 'DMC26002', hash, 'student', t0).lastInsertRowid;
  const studDel1 = insUser.run(cDel, 'Manav Gupta (Member)', 'student.delhi@dmc.example', 'DMC26003', hash, 'student', t0).lastInsertRowid;

  insMem.run(clubDel1, presDel1, 'president', t0, t0);
  insMem.run(clubDel1, treasDel1, 'treasurer', t0, t0);
  insMem.run(clubDel1, studDel1, 'member', t0, t0);

  // Add more student cohort members
  const NAMES = ['Aaditya Roy', 'Ananya Sen', 'Karthik Pillai', 'Pooja Hegde', 'Megha Jain', 'Siddharth Bose', 'Riya Kapoor', 'Harsh Vardhan', 'Anika Dixit', 'Tarun Sethi'];
  for (let i = 0; i < NAMES.length; i++) {
    const sId = insUser.run(cBlr, NAMES[i], `student.b${i + 10}@msot.example`, `MSOT260${i + 10}`, hash, 'student', t0).lastInsertRowid;
    insMem.run(i % 2 === 0 ? clubBlr1 : clubBlr2, sId, 'member', t0, t0);
  }

  // =========================================================================
  // 6. BUDGET REQUESTS & APPROVAL TIMELINE DEMO DATA
  // Demonstrating the 3-tier workflow: Treasurer -> Faculty Advisor -> College Administration
  // =========================================================================
  const insBudget = db.prepare(`INSERT INTO budget_requests(
    club_id, requested_by, title, category, amount_inr, purpose, items_json, sheet_link, supporting_docs, notes,
    status, advisor_feedback, college_feedback, decided_by, created_at, updated_at, decided_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const insAuditTimeline = db.prepare('INSERT INTO budget_approvals(budget_request_id, actor_id, stage, action, notes, created_at) VALUES (?,?,?,?,?,?)');

  // Request 1: Draft stage (Coding Club, BLR)
  const b1Items = JSON.stringify([
    { item: 'AWS Cloud Server Credits (Hackathon)', qty: 1, unit_cost: 15000 },
    { item: 'Domain Registration & SSL Certificates', qty: 3, unit_cost: 1500 },
    { item: 'Network Switch & Ethernet Cables (100m)', qty: 1, unit_cost: 4500 },
  ]);
  const b1 = insBudget.run(
    clubBlr1, treasBlr1, 'Hackathon Server & Cloud Credits', 'Technology', 24000,
    'Compute power and server bandwidth for the 24-hour inter-club hackathon.',
    b1Items, 'https://docs.google.com/spreadsheets/d/demo-hackathon-cloud/edit',
    'https://example.com/quotes/aws-education-pack.pdf',
    'Draft prepared by Coding Club Treasurer. Need final signoff on server specs before submitting to Advisor.',
    'Draft', null, null, null, t0, t0, null
  ).lastInsertRowid;
  insAuditTimeline.run(b1, treasBlr1, 'treasurer', 'draft', 'Created initial draft costing sheet.', t0);

  // Request 2: Submitted to Advisor stage (Entrepreneurship Club, BLR)
  const b2Items = JSON.stringify([
    { item: 'Pitch Deck Printing & Dossiers', qty: 50, unit_cost: 150 },
    { item: 'Mentor & Guest Speaker Hospitality', qty: 6, unit_cost: 2500 },
    { item: 'Stage Backdrop & Banner Standees', qty: 4, unit_cost: 4000 },
  ]);
  const b2 = insBudget.run(
    clubBlr2, treasBlr2, 'Founder Pitch Day Setup & Mentors Hospitality', 'Event', 38500,
    'Host venture capital investors and startup founders for the annual startup demo day.',
    b2Items, 'https://docs.google.com/spreadsheets/d/demo-ecell-pitchday/edit',
    'https://example.com/proposals/ecell-pitch-day-2026.pdf',
    'Submitted to Dr. Meera Iyer for Faculty Advisor review.',
    'Submitted to Advisor', null, null, null, t0, t0, null
  ).lastInsertRowid;
  insAuditTimeline.run(b2, treasBlr2, 'treasurer', 'submit', 'Submitted budget proposal to Faculty Advisor for review.', t0);

  // Request 3: Advisor Changes Requested stage (Robotics Club, BLR)
  const b3Items = JSON.stringify([
    { item: 'ESP32 Development Microcontrollers', qty: 10, unit_cost: 850 },
    { item: 'LiPo Batteries & Smart Chargers', qty: 10, unit_cost: 1200 },
    { item: 'High-Torque Metal Gear Servo Motors', qty: 20, unit_cost: 650 },
    { item: 'Temperature-Controlled Soldering Stations', qty: 2, unit_cost: 5750 },
  ]);
  const b3 = insBudget.run(
    clubBlr3, treasBlr3, 'Robotics Hardware Sensors & Soldering Tools', 'Equipment', 45000,
    'Replenish component inventories and upgrade soldering tools for beginner hands-on sessions.',
    b3Items, 'https://docs.google.com/spreadsheets/d/demo-robotics-lab/edit',
    'https://example.com/quotations/robotics-components.pdf',
    'Awaiting revisions from Treasurer Dev Kulkarni.',
    'Advisor Changes Requested',
    'Please itemize the microcontroller supplier warranty and attach an alternate vendor quote for the soldering stations.',
    null, null, t0, t0, null
  ).lastInsertRowid;
  insAuditTimeline.run(b3, treasBlr3, 'treasurer', 'submit', 'Submitted component procurement request.', t0);
  insAuditTimeline.run(b3, advBlr3, 'faculty_advisor', 'request_changes', 'Please itemize the microcontroller supplier warranty and attach an alternate vendor quote for the soldering stations.', t0);

  // Request 4: Sent to College / Advisor Approved stage (Film Club, MUM)
  const b4Items = JSON.stringify([
    { item: 'Cinema 4K Camera Rig Rental (3 Days)', qty: 2, unit_cost: 12000 },
    { item: 'Directional Boom Microphone & Sound Blimp', qty: 2, unit_cost: 5000 },
    { item: 'LED Fresnel Lighting Kit Rental', qty: 2, unit_cost: 8000 },
    { item: 'Color-Accurate Preview Monitor Rental', qty: 2, unit_cost: 6000 },
  ]);
  const b4 = insBudget.run(
    clubMum1, treasMum1, 'Annual Short Film Festival Camera Rig & Sound Gear Rental', 'Equipment', 62000,
    'Production equipment for student short films selected for the Inter-Campus Film Showcase.',
    b4Items, 'https://docs.google.com/spreadsheets/d/demo-film-rental/edit',
    'https://example.com/contracts/mumbai-camera-rentals.pdf',
    'Advisor approved. Forwarded to Mumbai Campus Admin Vikram Deshmukh.',
    'Sent to College',
    'Reviewed equipment list with club leadership. Highly recommended for the campus cultural calendar.',
    null, null, t0, t0, null
  ).lastInsertRowid;
  insAuditTimeline.run(b4, treasMum1, 'treasurer', 'submit', 'Submitted rental budget for film festival production.', t0);
  insAuditTimeline.run(b4, advMum1, 'faculty_advisor', 'approve', 'Reviewed equipment list with club leadership. Highly recommended for the campus cultural calendar.', t0);

  // Request 5: College Approved stage (Finance Club, MUM)
  const b5Items = JSON.stringify([
    { item: 'Market Terminal Simulation License (1 Month)', qty: 25, unit_cost: 500 },
    { item: 'Financial Modeling Case Study Books', qty: 15, unit_cost: 400 },
  ]);
  const b5 = insBudget.run(
    clubMum2, treasMum2, 'Trading Terminal Subscriptions & Modeling Workshop', 'Operational', 18500,
    'Hands-on portfolio construction and financial modeling boot camp for student members.',
    b5Items, 'https://docs.google.com/spreadsheets/d/demo-finance-lic/edit',
    'https://example.com/invoices/fintech-license.pdf',
    'Approved in full by College Administration.',
    'College Approved',
    'Solid educational value. Forwarded for college sanction.',
    'Approved in full from FY26 student enrichment budget. Disbursements to be settled against receipts within 14 days.',
    adminMum, t0, t0, t0
  ).lastInsertRowid;
  insAuditTimeline.run(b5, treasMum2, 'treasurer', 'submit', 'Submitted workshop simulation licenses request.', t0);
  insAuditTimeline.run(b5, advMum2, 'faculty_advisor', 'approve', 'Solid educational value. Forwarded for college sanction.', t0);
  insAuditTimeline.run(b5, adminMum, 'college_admin', 'approve', 'Approved in full from FY26 student enrichment budget. Disbursements to be settled against receipts within 14 days.', t0);

  // Request 6: College Rejected stage (Debating Society, DEL)
  const b6Items = JSON.stringify([
    { item: 'Airfare for 6 Debate Delegates (Delhi - Singapore)', qty: 6, unit_cost: 12000 },
    { item: 'International Delegate Registration Fee', qty: 6, unit_cost: 2166 },
  ]);
  const b6 = insBudget.run(
    clubDel1, treasDel1, 'International Model UN Flight Travel Reimbursement', 'Travel', 85000,
    'Travel reimbursement for international debate championship delegation.',
    b6Items, 'https://docs.google.com/spreadsheets/d/demo-debate-travel/edit',
    'https://example.com/invitations/mun-2026.pdf',
    'Rejected by College Administration.',
    'College Rejected',
    'Forwarded to college administration for exceptional approval under international outreach.',
    'Flight travel outside institutional guidelines for student clubs. Please re-apply with domestic tournament options or seek student co-sponsorship.',
    adminDel, t0, t0, t0
  ).lastInsertRowid;
  insAuditTimeline.run(b6, treasDel1, 'treasurer', 'submit', 'Submitted delegate travel support request.', t0);
  insAuditTimeline.run(b6, advDel1, 'faculty_advisor', 'approve', 'Forwarded to college administration for exceptional approval under international outreach.', t0);
  insAuditTimeline.run(b6, adminDel, 'college_admin', 'reject', 'Flight travel outside institutional guidelines for student clubs. Please re-apply with domestic tournament options or seek student co-sponsorship.', t0);

  // =========================================================================
  // 7. ANNOUNCEMENTS PER CAMPUS & CLUB
  // =========================================================================
  const insAnn = db.prepare('INSERT INTO announcements(campus_id,club_id,title,body,author_id,is_public,created_at) VALUES (?,?,?,?,?,1,?)');

  insAnn.run(cBlr, null, 'Campus Wide: Spring Club Registration Now Open', 'All students across Mirai Bengaluru can join up to 3 clubs. Check the Clubs tab to review active clubs and submit your membership request.', adminBlr, t0);
  insAnn.run(cBlr, clubBlr1, 'Coding Club: Git & Pull Request Workshop this Saturday', 'Bring your laptops with Git and VS Code pre-installed. We will be building collaborative open-source repositories.', advBlr1, t0);
  insAnn.run(cMum, null, 'Apex Mumbai: Inter-Collegiate Media Showcase 2026', 'Apex Mumbai will host delegates from 12 colleges across the region. Review the Events tab for registration details.', adminMum, t0);
  insAnn.run(cMum, clubMum1, 'Film Society: Camera Rig Auditions & Storyboard Pitching', 'Director pitches for the annual short film showcase will take place in Studio A this Saturday at 15:00.', advMum1, t0);
  insAnn.run(cDel, null, 'Delhi Campus: Annual Parliamentary Debating Openings', 'Join the DMC Debating Society this weekend for impromptu motion debates and policy mock trials.', adminDel, t0);

  // =========================================================================
  // 8. CLUB DAYS & ACTIVITIES (MSOT BENGALURU)
  // =========================================================================
  const dayIds = {};
  for (const off of [-21, -14, -7, 0, 7, 14]) {
    dayIds[off] = db.prepare('INSERT INTO club_days(campus_id,date,title,venue) VALUES (?,?,?,?)').run(cBlr, day(sat0, off), 'Club Day', 'Bengaluru Main Campus').lastInsertRowid;
  }
  const mkAct = (clubId, off, topic, format, status, createdBy, comment = null) => db.prepare(`INSERT INTO activities(club_id,club_day_id,topic,format,deliverable,venue,submission_deadline,status,advisor_comment,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(clubId, dayIds[off], topic, format,
    format === 'ppt' ? 'A 5-slide pitch with core technical architecture' : format === 'assignment' ? 'A written technical implementation report' : null,
    'Seminar Hall 2', `${day(sat0, off + 2)}T18:29:00.000Z`, status, comment, createdBy, t0).lastInsertRowid;

  mkAct(clubBlr1, 0, 'Full-Stack API Design & Rate Limiting', 'ppt', 'approved', presBlr1);
  mkAct(clubBlr2, 0, 'Pricing Experiments & Business Unit Economics', 'assignment', 'approved', presBlr2);
  mkAct(clubBlr3, 0, 'PID Motor Tuning & Sensor Calibration', 'on_the_spot', 'approved', treasBlr3);

  // Upcoming plans in review
  mkAct(clubBlr1, 7, 'Distributed Caching with Redis & Memory Graphs', 'ppt', 'approved', presBlr1);
  mkAct(clubBlr2, 7, 'Customer Discovery Interviews & Persona Mapping', 'assignment', 'pending', presBlr2);

  ctx.audit(superAdmin, 'seed.multi_campus', 'system', '-', {
    campuses: 3,
    clubs: 8,
    budget_requests: 6,
  });

  const jobs = runScheduler(ctx);

  return {
    superAdmin,
    adminBlr,
    adminMum,
    adminDel,
    campuses: [cBlr, cMum, cDel],
    clubs: [clubBlr1, clubBlr2, clubBlr3, clubMum1, clubMum2, clubMum3, clubDel1, clubDel2],
    jobs,
  };
}
