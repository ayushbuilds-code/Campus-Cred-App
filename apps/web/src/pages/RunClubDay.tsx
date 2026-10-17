import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../lib/api';
import { Button, Field, Loading, Modal, StatusBadge, useAction } from '../components/ui';
import { fmtTime, POSITION } from '../lib/format';

// The coordinator's live screen: a rotating QR, the matching 6-digit code and a live attendance list.
export default function RunClubDay() {
  const { id } = useParams();
  const nav = useNavigate();
  const [live, setLive] = useState<any>(null);
  const [err, setErr] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [fix, setFix] = useState<any>(null);
  const polling = useRef(false);
  const { run, busy } = useAction();

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try { const d = await api(`/sessions/${id}/live`); setLive(d); setExpiresAt(Date.now() + d.expires_in * 1000); setErr(''); }
    catch (e: any) { setErr(e.message); }
    finally { polling.current = false; }
  }, [id]);
  useEffect(() => { poll(); const t = setInterval(poll, 2500); return () => clearInterval(t); }, [poll]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  useEffect(() => { if (expiresAt && now >= expiresAt - 150) poll(); }, [now, expiresAt, poll]);

  if (!live) return <div className="min-h-screen bg-ink text-white">{err ? <div className="p-6"><p role="alert" className="rounded-lg bg-danger p-4">{err}</p><Link to="/" className="mt-4 inline-block underline">Back to home</Link></div> : <Loading />}</div>;
  const s = live.session, open = s.status === 'open';
  const back = s.kind === 'club_day' ? `/activities/${s.activity_id}` : `/events/${s.event_id}`;
  const remaining = Math.max(0, (expiresAt - now) / 1000), frac = Math.min(1, remaining / live.rotate_seconds);
  const waiting = live.roster.filter((r: any) => r.status === 'absent'), here = live.roster.filter((r: any) => r.status !== 'absent').sort((a: any, b: any) => (b.checked_at || '').localeCompare(a.checked_at || ''));
  const pct = live.counts.expected ? Math.round(((live.counts.present + live.counts.late) / live.counts.expected) * 100) : 0;
  const code = live.code ? `${live.code.slice(0, 3)} ${live.code.slice(3)}` : '';
  const R = 118, C = 2 * Math.PI * R;
  const close = async () => { if (confirm('Close check-in? Students will no longer be able to check in.') && (await run(() => api(`/sessions/${id}/close`, { method: 'POST' }), 'Check-in closed'))) poll(); };

  return (
    <div className="min-h-screen bg-ink text-white" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div><Link to={back} className="text-sm font-semibold text-white/70 hover:text-white">← Back</Link><h1 className="font-display text-xl font-bold md:text-2xl">{s.club_name ? `${s.club_name}: ` : ''}{s.topic}</h1></div>
        <div className="flex items-center gap-2">{open ? <Button variant="danger" loading={busy} onClick={close}>Close check-in</Button> : <span className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold">Check-in closed</span>}</div>
      </header>
      {err && <p role="alert" className="mx-4 mb-2 rounded-lg bg-danger px-3 py-2 text-sm md:mx-8">Connection problem: {err}. Retrying…</p>}
      <div className="grid gap-6 px-4 pb-10 md:grid-cols-[minmax(0,420px)_1fr] md:px-8">
        <section aria-label="Check-in code" className="flex flex-col items-center">
          {open ? (<>
            <div className="relative flex h-[300px] w-[300px] items-center justify-center rounded-3xl bg-white sm:h-[340px] sm:w-[340px]">
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 260 260" aria-hidden><circle cx="130" cy="130" r={R} fill="none" stroke="#E3F0EE" strokeWidth="6" /><circle cx="130" cy="130" r={R} fill="none" stroke={remaining < 5 ? '#E39B0B' : '#0E6B63'} strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} /></svg>
              <QRCodeSVG value={`${window.location.origin}/checkin?t=${live.token}`} size={220} level="M" fgColor="#10242B" />
            </div>
            <p className="mt-4 text-sm text-white/70">Or enter this code in the app</p>
            <p aria-live="off" className="font-display text-6xl font-extrabold tracking-wide tabular-nums">{code}</p>
            <p className="mt-1 text-sm text-white/60">Refreshes in {Math.ceil(remaining)} s. Screenshots stop working.</p>
            <p className="mt-3 text-sm text-white/60">Open until {fmtTime(s.closes_at)} · late after {fmtTime(s.late_after)}</p>
          </>) : <div className="rounded-3xl bg-white/10 p-8 text-center"><p className="font-display text-2xl font-bold">Check-in is closed</p><p className="mt-2 text-white/70">Final: {live.counts.present} present, {live.counts.late} late, {live.counts.expected - live.counts.present - live.counts.late} absent.</p><Link to={back}><Button variant="accent" className="mt-4">Back to the activity</Button></Link></div>}
        </section>
        <section aria-label="Attendance">
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="flex items-end justify-between"><p className="font-display text-5xl font-extrabold tabular-nums">{live.counts.present + live.counts.late}<span className="text-2xl text-white/50"> / {live.counts.expected}</span></p><p className="text-sm text-white/70">{live.counts.late > 0 ? `${live.counts.late} late · ` : ''}{pct}% checked in</p></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-saffron transition-all" style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div><h2 className="mb-2 font-display text-lg font-bold">Checked in ({here.length})</h2>
              <ul className="max-h-[46vh] space-y-1.5 overflow-y-auto">{here.map((r: any) => <li key={r.user_id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm"><span><span className="font-semibold">{r.name}</span> {r.position !== 'member' && <span className="text-white/50">{POSITION[r.position]}</span>}{r.flag && r.flag !== 'Late' && <span className="block text-xs text-saffron">{r.flag}</span>}</span><span className="flex items-center gap-2 text-white/60">{fmtTime(r.checked_at)} <StatusBadge status={r.status} /></span></li>)}
                {here.length === 0 && <li className="text-sm text-white/50">Nobody yet. Show the QR to the room.</li>}</ul></div>
            <div><h2 className="mb-2 font-display text-lg font-bold">Waiting ({waiting.length})</h2>
              <ul className="max-h-[46vh] space-y-1.5 overflow-y-auto">{waiting.map((r: any) => <li key={r.user_id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm"><span className="font-semibold">{r.name}</span><button className="rounded-md px-2 py-1 text-xs font-semibold text-saffron hover:bg-white/10" onClick={() => setFix(r)}>Mark present</button></li>)}
                {waiting.length === 0 && <li className="text-sm text-white/50">Everyone is in.</li>}</ul></div>
          </div>
        </section>
      </div>
      {fix && <Fix sessionId={s.id} row={fix} onClose={() => setFix(null)} onDone={() => { setFix(null); poll(); }} />}
      <span hidden>{nav.length}</span>
    </div>
  );
}

function Fix({ sessionId, row, onClose, onDone }: { sessionId: number; row: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await run(() => api(`/sessions/${sessionId}/attendance`, { body: { user_id: row.user_id, status: 'present', reason } }), 'Marked present and logged')) onDone(); };
  return (
    <div className="text-ink"><Modal title={`Mark ${row.name} present`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3"><Field label="Reason" hint="Required. Saved in the audit log with your name."><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="Phone died, was in the hall" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Mark present</Button></div></form></Modal></div>
  );
}
