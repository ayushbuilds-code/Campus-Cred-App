import { iso } from './lib/util.js';

// Shared services passed to every route module. `now` is injectable so tests can move the clock.
export function makeCtx({ db, cfg, now = () => Date.now() }) {
  const insAudit = db.prepare(
    'INSERT INTO audit_log(actor_id,action,entity,entity_id,old_value,new_value,reason,created_at) VALUES (?,?,?,?,?,?,?,?)');
  const insNotif = db.prepare('INSERT INTO notifications(user_id,title,body,link,read,created_at) VALUES (?,?,?,?,0,?)');
  const insMail = db.prepare("INSERT INTO outbox(channel,to_addr,subject,body,created_at) VALUES ('email',?,?,?,?)");
  const qEmail = db.prepare('SELECT email FROM users WHERE id=?');
  const qSetting = db.prepare('SELECT value FROM settings WHERE key=?');
  const js = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

  return {
    db, cfg, now,
    setting(key) { const r = qSetting.get(key); return r ? JSON.parse(r.value) : undefined; },
    audit(actorId, action, entity, entityId, { old, neu, reason } = {}) {
      insAudit.run(actorId ?? null, action, entity, String(entityId ?? ''), js(old), js(neu), reason ?? null, iso(now()));
    },
    // In-app notification + email (email is written to the `outbox` table; plug an SMTP/WhatsApp
    // sender onto that table to deliver them, see docs/ARCHITECTURE.md).
    notify(userIds, title, body, link, { email = true } = {}) {
      const ids = [...new Set(userIds.filter(Boolean))];
      if (!ids.length) return;
      const t = iso(now());
      db.transaction(() => {
        for (const id of ids) {
          insNotif.run(id, title, body ?? null, link ?? null, t);
          if (email) { const e = qEmail.get(id); if (e) insMail.run(e.email, title, body ?? null, t); }
        }
      })();
    },
  };
}
