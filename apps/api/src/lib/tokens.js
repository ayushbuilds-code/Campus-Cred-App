// Rotating, server-signed check-in tokens. A screenshot of the QR is only valid for
// between ROTATE and 2*ROTATE seconds, so forwarding it over WhatsApp does not work.
import crypto from 'node:crypto';

export const slotNow = (nowMs, rot) => Math.floor(nowMs / 1000 / rot);
const mac = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest();
export const sigFor = (secret, sid, slot) => mac(secret, `${sid}.${slot}`).toString('hex').slice(0, 20);
export const makeToken = (session, slot) => `${session.id}.${slot}.${sigFor(session.secret, session.id, slot)}`;
export const codeFor = (secret, sid, slot) =>
  String(mac(secret, `code.${sid}.${slot}`).readUInt32BE(0) % 1000000).padStart(6, '0');

export function parseToken(t) {
  const p = String(t || '').split('.');
  if (p.length !== 3) return null;
  const sid = Number(p[0]), slot = Number(p[1]);
  if (!Number.isInteger(sid) || !Number.isInteger(slot)) return null;
  return { sid, slot, sig: p[2] };
}

// Returns 'ok' | 'expired' | 'forged'
export function tokenState(session, parsed, nowMs, rot) {
  const a = Buffer.from(sigFor(session.secret, session.id, parsed.slot));
  const b = Buffer.from(String(parsed.sig));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'forged';
  const cur = slotNow(nowMs, rot);
  return parsed.slot === cur || parsed.slot === cur - 1 ? 'ok' : 'expired';
}

export function codeMatches(session, code, nowMs, rot) {
  const cur = slotNow(nowMs, rot);
  return [cur, cur - 1].some((s) => codeFor(session.secret, session.id, s) === code);
}
