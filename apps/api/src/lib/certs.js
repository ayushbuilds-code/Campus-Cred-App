import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { iso, isUnique } from './util.js';

const TEAL = '#0E6B63', INK = '#10242B', GOLD = '#E39B0B', MUTED = '#5B6B6F';
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fmtDate = (s) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

function render(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'CampusCred document', Producer: 'CampusCred' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    Promise.resolve(draw(doc)).then(() => doc.end(), reject);
  });
}

function stamp(doc, x, y) {
  doc.save().rotate(-12, { origin: [x, y] });
  doc.lineWidth(2).strokeColor(TEAL).circle(x, y, 44).stroke();
  doc.lineWidth(0.8).circle(x, y, 38).stroke();
  doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(13).text('Verified', x - 40, y - 14, { width: 80, align: 'center' });
  doc.font('Helvetica').fontSize(8).text('CampusCred', x - 40, y + 4, { width: 80, align: 'center' });
  doc.restore();
}

export function drawCertificate(doc, c, qr) {
  doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
  const W = doc.page.width, H = doc.page.height;
  doc.rect(22, 22, W - 44, H - 44).lineWidth(3).strokeColor(TEAL).stroke();
  doc.rect(32, 32, W - 64, H - 64).lineWidth(0.8).strokeColor(GOLD).stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(11).text('Mirai School of Technology  |  CampusCred', 0, 62, { width: W, align: 'center' });
  doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(34)
    .text(c.kind === 'achievement' ? 'Certificate of Achievement' : 'Certificate of Participation', 0, 92, { width: W, align: 'center' });
  doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(14).text('This is to certify that', 0, 160, { width: W, align: 'center' });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(36).text(c.holder, 60, 188, { width: W - 120, align: 'center' });
  doc.moveTo(W / 2 - 170, 238).lineTo(W / 2 + 170, 238).lineWidth(0.8).strokeColor(GOLD).stroke();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(c.title, 90, 262, { width: W - 180, align: 'center' });
  if (c.detail) doc.fillColor(MUTED).font('Helvetica').fontSize(13).text(c.detail, 120, 300, { width: W - 240, align: 'center', lineGap: 3 });
  const where = [c.club, c.event].filter(Boolean).join('  |  ');
  if (where) doc.fillColor(INK).font('Helvetica').fontSize(12).text(where, 0, 372, { width: W, align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(`Issued on ${fmtDate(c.issuedAt)}`, 70, 440);
  if (c.issuer) doc.text(`Issued by ${c.issuer}`, 70, 458);
  doc.fontSize(8).text(`Certificate ID: ${c.id}`, 70, 500);
  doc.text(`Record hash: ${c.contentHash.slice(0, 32)}...`, 70, 512);
  stamp(doc, W / 2, 468);
  doc.image(qr, W - 160, 432, { width: 84 });
  doc.fontSize(8).fillColor(MUTED).text('Scan to verify', W - 160, 520, { width: 84, align: 'center' });
}

export function drawTranscript(doc, t, qr) {
  doc.addPage({ size: 'A4', margin: 0 });
  const W = doc.page.width, M = 42;
  let y = 0;
  const ensure = (h) => { if (y + h > doc.page.height - 60) { doc.addPage(); y = 50; } };
  doc.rect(0, 0, W, 96).fill(TEAL);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(22).text('Co-curricular transcript', M, 30);
  doc.font('Helvetica').fontSize(11).text('Mirai School of Technology  |  verified by CampusCred', M, 62);
  y = 118;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(t.student.name, M, y);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`${t.student.student_code || ''}  |  ${t.student.campus || ''}  |  generated ${fmtDate(t.generatedAt)}`, M, y + 22);
  y += 52;
  const s = t.summary;
  const boxes = [['Clubs', s.clubs], ['Sessions attended', s.attended], ['Submissions', s.submissions], ['Average score', s.avg_score ?? '-'], ['Certificates', s.certificates]];
  const bw = (W - 2 * M - 4 * 8) / 5;
  boxes.forEach(([label, val], i) => {
    const x = M + i * (bw + 8);
    doc.roundedRect(x, y, bw, 52, 6).lineWidth(0.8).strokeColor('#D9DED8').stroke();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(String(val), x + 8, y + 8, { width: bw - 16 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(label, x + 8, y + 34, { width: bw - 16 });
  });
  y += 72;
  const heading = (txt) => { ensure(40); doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(12).text(txt, M, y); y += 20; };
  const row = (cols, widths, bold) => {
    ensure(20);
    let x = M;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(INK);
    cols.forEach((c, i) => { doc.text(String(c ?? ''), x, y, { width: widths[i] - 6, height: 12, ellipsis: true }); x += widths[i]; });
    y += 17;
    doc.moveTo(M, y - 4).lineTo(W - M, y - 4).lineWidth(0.4).strokeColor('#E3E7E2').stroke();
  };
  heading('Clubs');
  const cw = [150, 90, 90, 80, 80];
  row(['Club', 'Position', 'Attendance', 'Submissions', 'Avg score'], cw, true);
  t.clubs.forEach((c) => row([c.club, c.position.replace('_', ' '), `${c.attended}/${c.sessions} (${c.attendance_pct}%)`, c.submissions, c.avg_score ?? '-'], cw));
  if (!t.clubs.length) row(['No club memberships yet'], [400]);
  y += 8; heading('Events');
  const ew = [200, 100, 120, 70];
  row(['Event', 'Date', 'Team', 'Result'], ew, true);
  t.events.forEach((e) => row([e.name, e.date, e.team || 'Individual', e.position ? `#${e.position}` : '-'], ew));
  if (!t.events.length) row(['No event participation yet'], [400]);
  y += 8; heading('Certificates');
  const tw = [120, 230, 90, 70];
  row(['ID', 'Title', 'Issued', 'Status'], tw, true);
  t.certificates.slice(0, 60).forEach((c) => row([c.id, c.title, c.issued_at.slice(0, 10), c.status], tw));
  if (!t.certificates.length) row(['No certificates yet'], [400]);
  ensure(110);
  y = Math.max(y + 16, 0);
  doc.image(qr, W - M - 84, y, { width: 84 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text(`Transcript ID: ${t.id}`, M, y + 8).text(`Data hash: ${t.dataHash}`, M, y + 22)
    .text('Scan the QR code to confirm this transcript was issued by CampusCred.', M, y + 36, { width: 250 });
  stamp(doc, W - M - 175, y + 42);
}

// Issue (and store) one certificate or transcript. Idempotent when refKey is supplied.
export async function issueCertificate(ctx, o) {
  const { db, cfg, now } = ctx;
  if (o.refKey) {
    const ex = db.prepare('SELECT * FROM certificates WHERE user_id=? AND kind=? AND ref_key=?').get(o.userId, o.kind, o.refKey);
    if (ex) return { cert: ex, created: false };
  }
  const user = db.prepare('SELECT name, student_code FROM users WHERE id=?').get(o.userId);
  const club = o.clubId ? db.prepare('SELECT name FROM clubs WHERE id=?').get(o.clubId) : null;
  const event = o.eventId ? db.prepare('SELECT name FROM events WHERE id=?').get(o.eventId) : null;
  const issuer = o.issuedBy ? db.prepare('SELECT name FROM users WHERE id=?').get(o.issuedBy) : null;
  const issuedAt = iso(now());
  const id = `CC-${issuedAt.slice(0, 4)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const contentHash = sha256(JSON.stringify([id, user.name, user.student_code, o.kind, o.title, o.detail || '', club?.name || '', event?.name || '', issuedAt]));
  const qr = await QRCode.toBuffer(`${cfg.publicUrl}/verify/${id}`, { margin: 1, width: 260, errorCorrectionLevel: 'M' });
  const pdf = await render((doc) => {
    if (o.kind === 'transcript') drawTranscript(doc, { ...o.transcript, id, dataHash: o.transcript.dataHash }, qr);
    else drawCertificate(doc, { id, kind: o.kind, holder: user.name, title: o.title, detail: o.detail, club: club?.name, event: event?.name, issuedAt, issuer: issuer?.name, contentHash }, qr);
  });
  const fileHash = sha256(pdf);
  fs.mkdirSync(cfg.certDir, { recursive: true });
  const filePath = path.join(cfg.certDir, `${id}.pdf`);
  fs.writeFileSync(filePath, pdf);
  try {
    db.prepare(`INSERT INTO certificates(id,user_id,club_id,event_id,kind,title,detail,ref_key,issued_by,issued_at,content_hash,file_hash,file_path)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, o.userId, o.clubId ?? null, o.eventId ?? null, o.kind, o.title, o.detail ?? null, o.refKey ?? null, o.issuedBy ?? null, issuedAt, contentHash, fileHash, filePath);
  } catch (e) {
    fs.rmSync(filePath, { force: true });
    if (isUnique(e) && o.refKey) return { cert: db.prepare('SELECT * FROM certificates WHERE user_id=? AND kind=? AND ref_key=?').get(o.userId, o.kind, o.refKey), created: false };
    throw e;
  }
  return { cert: db.prepare('SELECT * FROM certificates WHERE id=?').get(id), created: true };
}
